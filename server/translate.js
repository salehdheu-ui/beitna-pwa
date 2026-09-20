'use strict';

/* ترجمة محتوى العاملة فقط. النص الأصلي يبقى المصدر الرسمي، بينما تُحفظ
   النسختان العربية والإنجليزية بجانبه حتى لا نعيد إرسال النص إلى المزود
   عند كل فتح أو مزامنة. */

const crypto = require('crypto');

const SUPPORTED_LANGS = new Set(['ar', 'en', 'hi', 'si', 'ta', 'am', 'tl', 'id', 'my', 'sw', 'ne']);
const FIELDS = {
  shopping: ['name', 'quantity', 'note'],
  faults: ['title', 'location', 'note'],
};
const TARGETS = ['ar', 'en'];
const CACHE_MAX = 5000;
const CHUNK_BYTES = 450; // MyMemory يقبل 500 بايت كحد أقصى للطلب الواحد.
const MAX_CHUNKS = 12;
const FAILURE_COOLDOWN_MS = 60000;

const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const normalizeLang = (code, fallback = 'ar') => SUPPORTED_LANGS.has(String(code)) ? String(code) : fallback;
const cacheKey = (source, target, text) => crypto.createHash('sha256')
  .update(`${source}\0${target}\0${text}`).digest('hex');

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** تقسيم UTF-8 من دون قطع حرف متعدد البايتات. */
function chunksOf(value) {
  const chunks = [];
  let part = '';
  for (const char of String(value || '')) {
    if (Buffer.byteLength(part + char, 'utf8') > CHUNK_BYTES) {
      if (chunks.length >= MAX_CHUNKS - 1) throw new Error('translation-text-too-long');
      if (part) chunks.push(part);
      part = char;
    } else part += char;
  }
  if (part && chunks.length < MAX_CHUNKS) chunks.push(part);
  return chunks;
}

function pruneCache(cache) {
  const entries = Object.entries(cache || {});
  if (entries.length <= CACHE_MAX) return;
  entries.sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0));
  const keep = new Set(entries.slice(0, CACHE_MAX).map(([key]) => key));
  for (const key of Object.keys(cache)) if (!keep.has(key)) delete cache[key];
}

function createTranslator({
  cache = {}, fetchFn = global.fetch,
  apiUrl = 'https://api.mymemory.translated.net/get',
  enabled = true, timeoutMs = 5000,
} = {}) {
  const inFlight = new Map();
  let unavailableUntil = 0;

  async function translateChunk(text, source, target) {
    if (!text || source === target) return text;
    const key = cacheKey(source, target, text);
    if (typeof cache[key]?.text === 'string') return cache[key].text;
    if (inFlight.has(key)) return inFlight.get(key);
    if (Date.now() < unavailableUntil) throw new Error('translation-cooldown');

    const task = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = new URL(apiUrl);
        url.searchParams.set('q', text);
        url.searchParams.set('langpair', `${source}|${target}`);
        url.searchParams.set('mt', '1');
        const response = await fetchFn(url, { signal: controller.signal, headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`translation-http-${response.status}`);
        const body = await response.json();
        if (body?.quotaFinished || Number(body?.responseStatus || 200) !== 200) {
          throw new Error('translation-unavailable');
        }
        const translated = decodeEntities(body?.responseData?.translatedText).trim();
        if (!translated) throw new Error('translation-empty');
        cache[key] = { text: translated, at: Date.now() };
        pruneCache(cache);
        return translated;
      } catch (error) {
        /* قاطع دائرة: عند تعطل الخدمة لا ننتظر المهلة من جديد لكل عنصر
           في دفعة أوفلاين كبيرة؛ نحفظ بقية العناصر بأصولها فورًا. */
        unavailableUntil = Date.now() + FAILURE_COOLDOWN_MS;
        throw error;
      } finally {
        clearTimeout(timer);
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, task);
    return task;
  }

  async function translateText(value, source, target) {
    const text = String(value || '').trim();
    if (!text || source === target) return text;
    const chunks = chunksOf(text);
    if (!chunks.length) return text;
    const translated = [];
    for (const chunk of chunks) translated.push(await translateChunk(chunk, source, target));
    return translated.join(' ').trim();
  }

  async function translateDocument(col, patch, sourceHint, previous = null) {
    const fields = FIELDS[col] || [];
    const changed = fields.filter((field) => own(patch, field));
    if (!enabled || !changed.length) return { ...(patch || {}) };

    const source = normalizeLang(patch?.sourceLang || sourceHint);
    const translations = {};
    for (const target of TARGETS) translations[target] = { ...(previous?.translations?.[target] || {}) };

    await Promise.all(TARGETS.flatMap((target) => changed.map(async (field) => {
      const original = String(patch[field] || '').trim();
      if (!original) { delete translations[target][field]; return; }
      try {
        translations[target][field] = await translateText(original, source, target);
      } catch {
        /* لا نعرض ترجمة قديمة لنص جديد. الواجهة ستعود إلى الأصل. */
        delete translations[target][field];
      }
    })));

    return { ...patch, sourceLang: source, translations };
  }

  return { translateDocument, translateText };
}

module.exports = { createTranslator, normalizeLang, FIELDS };
