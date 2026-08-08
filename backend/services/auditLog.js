// backend/services/auditLog.js
const { query } = require('../db/pool');

/**
 * Kritik CMS/finansal işlemleri değişmez şekilde kaydeder.
 * Hata durumunda ana işlemi bloklamaz (best-effort — audit yazımı asıl
 * işlemi asla başarısız kılmamalı, yalnızca konsola loglanır).
 */
async function recordAudit({ req, entity, entityId, action, diff }) {
  try {
    await query(
      `INSERT INTO audit_log (actor_user_id, actor_role, mall_id, entity, entity_id, action, diff, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        req.user?.id || null,
        req.user?.role || null,
        req.mall?.id || null,
        entity,
        entityId || null,
        action,
        diff ? JSON.stringify(diff) : null,
        req.ip,
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] yazım hatası (asıl işlem etkilenmedi):', err.message);
  }
}

module.exports = { recordAudit };
