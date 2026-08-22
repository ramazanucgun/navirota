// backend/services/planLimits.js
//
// Her AVM'nin bağlı olduğu plan (plans tablosu: max_stores, max_floors,
// max_admins, features JSONB) kaynak oluşturma uçlarında zorlanır. Bir
// limit dolduğunda 402 Payment Required döner (bilinçli seçim: 403 yerine
// 402 — istemci panelinde "planınızı yükseltin" akışını tetiklemek için
// ayırt edilebilir bir durum kodu).

const { query } = require('../db/pool');

async function getMallPlanContext(mallId) {
  const { rows } = await query(
    `SELECT p.id, p.code, p.max_stores, p.max_floors, p.max_admins, p.features
     FROM malls m JOIN plans p ON p.id = m.plan_id
     WHERE m.id = $1`,
    [mallId]
  );
  return rows[0] || null; // plan_id atanmamış (legacy/manuel) mall'lerde null döner — kısıtlama uygulanmaz
}

const COUNT_QUERIES = {
  stores: `SELECT count(*)::int AS n FROM stores WHERE mall_id = $1 AND is_active = true`,
  floors: `SELECT count(*)::int AS n FROM floors WHERE mall_id = $1`,
  // max_admins yalnızca mall_admin (panel yöneticisi) hesaplarını sınırlar;
  // store_manager hesapları zaten mağaza limitine (enforceLimit('stores'))
  // dolaylı olarak bağlıdır, ayrıca sınırlanmaz.
  admins: `SELECT count(*)::int AS n FROM users WHERE mall_id = $1 AND role = 'mall_admin' AND is_active = true`,
};
const LIMIT_FIELD = { stores: 'max_stores', floors: 'max_floors', admins: 'max_admins' };
const LABEL = { stores: 'mağaza', floors: 'kat', admins: 'panel kullanıcısı' };

/**
 * Saf kontrol fonksiyonu (middleware olmayan yerlerde de — örn. rol'e göre
 * koşullu kontrol gereken /admin/users davet uç noktasında — kullanılabilir).
 * @returns {Promise<{reached:boolean, limit:number|null, current:number}>}
 */
async function isLimitReached(resource, mallId) {
  const plan = await getMallPlanContext(mallId);
  if (!plan) return { reached: false, limit: null, current: 0 };
  const { rows } = await query(COUNT_QUERIES[resource], [mallId]);
  const current = rows[0].n;
  const limit = plan[LIMIT_FIELD[resource]];
  return { reached: current >= limit, limit, current };
}

/**
 * Kullanım: router.post('/stores', enforceLimit('stores'), async (req,res)=>{...})
 * `req.mall.id` dolu olmalı (scopeToMall'dan sonra çağrılmalı).
 */
function enforceLimit(resource) {
  return async (req, res, next) => {
    try {
      const { reached, limit, current } = await isLimitReached(resource, req.mall.id);
      if (reached) {
        return res.status(402).json({
          error: `Planınızın ${LABEL[resource]} limitine (${limit}) ulaştınız. Devam etmek için planınızı yükseltin.`,
          code: 'PLAN_LIMIT_REACHED',
          resource,
          limit,
          current,
        });
      }
      next();
    } catch (err) { next(err); }
  };
}

/**
 * Kullanım: router.get('/search', requireFeature('ai_search'), ...)
 * plan.features JSONB'de key açıkça `false` ise engeller; key hiç yoksa
 * (eski/tanımsız plan) varsayılan olarak İZİN VERİR — geriye dönük uyumluluk.
 */
function requireFeature(featureKey) {
  return async (req, res, next) => {
    try {
      const plan = await getMallPlanContext(req.mall.id);
      if (plan && plan.features && plan.features[featureKey] === false) {
        return res.status(402).json({
          error: 'Bu özellik mevcut planınıza dahil değil. Planınızı yükseltin.',
          code: 'FEATURE_NOT_IN_PLAN',
          feature: featureKey,
        });
      }
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { getMallPlanContext, isLimitReached, enforceLimit, requireFeature };
