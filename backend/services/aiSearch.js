// backend/services/aiSearch.js
//
// Doğal dil mağaza araması ("kahve içmek istiyorum" → kafe/restoran kategorisi).
// --------------------------------------------------------------------
// Tasarım notu (PRD Bölüm 10): Bu servis, diğer modüllerden bağımsız
// çalışacak şekilde izole edilmiştir. Bugün kural/sözlük tabanlı bir NLU
// (Faz 3 kapsamı için yeterli, gecikme ve maliyet açısından avantajlı),
// ancak `resolveIntent()` fonksiyonunun imzası bir LLM sağlayıcısıyla
// (örn. Anthropic Messages API) değiştirilmeye hazır tek giriş noktasıdır —
// çekirdek arama/reklam/analitik modülleri bu değişimden etkilenmez.
//
// İleride gerçek bir LLM entegrasyonu için: resolveIntent(query) içinde
// process.env.ANTHROPIC_API_KEY kontrolü yapılıp varsa api.anthropic.com'a
// "bu sorgu hangi kategoriyle eşleşir" promptu ile bir istek atılabilir;
// anahtar yoksa (bu ortamda olduğu gibi) sözlük tabanlı moda düşülür.
// --------------------------------------------------------------------

// Doğal dil kalıpları → kategori kodu. Anahtar kelime kümesi genişletilebilir.
const INTENT_LEXICON = [
  { category: 'yemek', keywords: ['kahve', 'kahve içmek', 'acıktım', 'yemek', 'restoran', 'aç', 'içecek', 'çay', 'tatlı', 'kafe', 'brunch', 'kahvaltı'] },
  { category: 'kadin', keywords: ['ceket', 'elbise', 'kadın', 'bayan', 'çanta', 'etek', 'bluz', 'tesettür'] },
  { category: 'erkek', keywords: ['erkek', 'gömlek', 'takım elbise', 'kravat', 'erkek pantolon'] },
  { category: 'ayakkabi', keywords: ['ayakkabı', 'bot', 'sneaker', 'topuklu', 'terlik', 'çocuk ayakkabısı'] },
  { category: 'elektronik', keywords: ['telefon', 'bilgisayar', 'elektronik', 'kulaklık', 'şarj', 'laptop', 'tablet', 'tv', 'televizyon'] },
];

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
 * skoruna göre sıralanmış şekilde döndürür.
 * @param {string} query
 * @returns {{ categories: string[], isNaturalLanguage: boolean }}
 */
function resolveIntent(query) {
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

module.exports = { resolveIntent, normalize };
