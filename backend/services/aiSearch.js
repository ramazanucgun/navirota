// backend/services/aiSearch.js
//
// Doğal dil mağaza araması ("kahve içmek istiyorum" → kafe/restoran kategorisi).
// --------------------------------------------------------------------
// Tasarım notu (PRD Bölüm 10): İki katmanlı çalışır:
//   1) Sözlük/kural tabanlı çözümleme (`resolveIntentLexicon`) — ücretsiz,
//      milisaniyeler içinde, ağ bağımlılığı yok. Çoğu sorguda yeterli.
//   2) Sözlük hiçbir kategoriyle eşleşmezse VE `ANTHROPIC_API_KEY`
//      tanımlıysa, Anthropic Messages API'sine (Claude Haiku — hızlı/ucuz)
//      tek bir sınıflandırma isteği atılır (`resolveIntentWithLLM`).
//      Anahtar tanımlı değilse ya da çağrı başarısız/zaman aşımına
//      uğrarsa sessizce sözlük sonucuna (boş de olabilir) düşülür — arama
//      uç noktası LLM'e bağımlı hale GELMEZ.
//
// AI_SEARCH_MOCK=true (ya da bu ortamda olduğu gibi Anthropic API'sine ağ
// erişimi yoksa) gerçek bir API çağrısı yapılmadan LLM katmanının iş
// mantığını (zaman aşımı, hata payı, birleştirme) test etmeyi sağlar.
// --------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MOCK_MODE = process.env.AI_SEARCH_MOCK === 'true';
const LLM_TIMEOUT_MS = 2500;
const LLM_MODEL = process.env.AI_SEARCH_MODEL || 'claude-haiku-4-5-20251001';

// Doğal dil kalıpları → kategori kodu. Anahtar kelime kümesi genişletilebilir.
const INTENT_LEXICON = [
  { category: 'yemek', keywords: ['kahve', 'kahve içmek', 'acıktım', 'yemek', 'restoran', 'aç', 'içecek', 'çay', 'tatlı', 'kafe', 'brunch', 'kahvaltı'] },
  { category: 'kadin', keywords: ['ceket', 'elbise', 'kadın', 'bayan', 'çanta', 'etek', 'bluz', 'tesettür'] },
  { category: 'erkek', keywords: ['erkek', 'gömlek', 'takım elbise', 'kravat', 'erkek pantolon'] },
  { category: 'ayakkabi', keywords: ['ayakkabı', 'bot', 'sneaker', 'topuklu', 'terlik', 'çocuk ayakkabısı'] },
  { category: 'elektronik', keywords: ['telefon', 'bilgisayar', 'elektronik', 'kulaklık', 'şarj', 'laptop', 'tablet', 'tv', 'televizyon'] },
];
const VALID_CATEGORY_CODES = INTENT_LEXICON.map((e) => e.category);

const STOPWORDS = new Set(['istiyorum', 'istiyorum.', 'bir', 'biraz', 'ben', 'için', 'lazım', 'arıyorum', 'nerede', 'var', 'mı', 'mi']);

/**
 * Bir sorgu metnini normalize edip Türkçe karakter/case farklarını sadeleştirir.
 */
function normalize(text) {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/[İIı]/g, 'i')
    .trim();
}

/**
 * Sözlük tabanlı niyet çözümleme. Eşleşen kategori kodlarını, güven
 * skoruna göre sıralanmış şekilde döndürür. Senkron, ücretsiz, her zaman
 * kullanılabilir — LLM katmanının ilk adımı ve tek başına da bir arama
 * motorudur.
 * @param {string} query
 * @returns {{ categories: string[], isNaturalLanguage: boolean }}
 */
function resolveIntentLexicon(query) {
  const norm = normalize(query);
  const words = norm.split(/\s+/).filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const isNaturalLanguage = words.length >= 3; // "kahve içmek istiyorum" gibi cümle-benzeri girişler

  const scores = new Map();
  for (const entry of INTENT_LEXICON) {
    for (const kw of entry.keywords) {
      if (norm.includes(kw)) {
        scores.set(entry.category, (scores.get(entry.category) || 0) + kw.split(' ').length);
      }
    }
  }

  const categories = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([cat]) => cat);
  return { categories, isNaturalLanguage };
}

/**
 * Sözlükte hiç eşleşme bulunamayan sorgular için LLM tabanlı sınıflandırma
 * (örn. "ayaklarım üşüyor" → 'ayakkabi', sözlükte "üşümek" yok ama bir LLM
 * bunu çıkarabilir). Her zaman `VALID_CATEGORY_CODES` kümesinden bir alt
 * küme döner ya da hiçbir şey (uydurma kategori kodu üretemez).
 * @returns {Promise<string[]>}
 */
async function resolveIntentWithLLM(query) {
  if (MOCK_MODE) {
    // Gerçek API çağrısı yapılmadan iş mantığını (zaman aşımı/hata payı
    // dışındaki "başarılı yanıt ayrıştırma" yolunu) test etmek için basit
    // bir sözde-sınıflandırma: sorguda geçen herhangi bir kategori kelimesi
    // kökünü arar. Gerçek LLM'in yerini TUTMAZ, yalnızca entegrasyon
    // iskeletini test edilebilir kılar.
    const norm = normalize(query);
    if (norm.includes('üşü') || norm.includes('ayak')) return ['ayakkabi'];
    if (norm.includes('müzik dinle') || norm.includes('şarkı')) return ['elektronik'];
    return [];
  }
  if (!ANTHROPIC_API_KEY) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 50,
        system:
          'Bir AVM arama motorusun. Kullanıcının Türkçe sorgusunu şu kategori ' +
          `kodlarından SIFIR ya da DAHA FAZLASIYLA eşleştir: ${VALID_CATEGORY_CODES.join(', ')}. ` +
          'SADECE bu listedeki kodlardan oluşan bir JSON dizisi döndür, başka hiçbir metin ekleme. ' +
          'Örnek: ["ayakkabi"] ya da eşleşme yoksa [].',
        messages: [{ role: 'user', content: query }],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = data.content?.find((b) => b.type === 'text')?.text || '[]';
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    // GÜVENLİK/DOĞRULUK: LLM'in ürettiği kod, uydurma ya da halüsinasyon
    // olabilir — yalnızca gerçekten var olan kategori kodları kabul edilir.
    return parsed.filter((c) => VALID_CATEGORY_CODES.includes(c));
  } catch {
    return []; // zaman aşımı, ağ hatası, geçersiz JSON — hepsi sessizce boş sonuca düşer
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * İki katmanlı niyet çözümleme: önce ücretsiz sözlük, yalnızca hiç eşleşme
 * yoksa (ve bir API anahtarı varsa) LLM'e başvurur. Bu sıralama, LLM
 * maliyetini/gecikmesini yalnızca gerçekten gerektiğinde harcar.
 * @param {string} rawQuery
 * @returns {Promise<{ categories: string[], isNaturalLanguage: boolean, source: 'lexicon'|'llm'|'none' }>}
 */
async function resolveIntent(rawQuery) {
  const lexiconResult = resolveIntentLexicon(rawQuery);
  if (lexiconResult.categories.length > 0) {
    return { ...lexiconResult, source: 'lexicon' };
  }
  if (!ANTHROPIC_API_KEY && !MOCK_MODE) {
    return { ...lexiconResult, source: 'none' };
  }
  const llmCategories = await resolveIntentWithLLM(rawQuery);
  return { categories: llmCategories, isNaturalLanguage: lexiconResult.isNaturalLanguage, source: llmCategories.length ? 'llm' : 'none' };
}

module.exports = { resolveIntent, resolveIntentLexicon, normalize };
