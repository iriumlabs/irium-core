#!/usr/bin/env node
/**
 * Auto-translate src/i18n/locales/en.json into all 13 non-English locales
 * using Google Translate's free unofficial endpoint (client=gtx, no API key).
 *
 * Notes:
 *   - The endpoint at translate.googleapis.com/translate_a/single is rate-limited
 *     but free for low-volume use. We add small delays between requests.
 *   - i18next interpolation placeholders ({{name}}, {{count}}) are extracted
 *     before translation and re-inserted afterward so they survive intact.
 *   - Strings shorter than 2 chars or pure punctuation/numbers are skipped.
 *   - All target locales are marked _meta.status="machine_translated",
 *     review_needed=true so the UI can surface the warning if it wants to.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const SOURCE_LANG = 'en';

// Target languages in priority order (es first because Ibrahim wanted Spanish
// finished first; the rest follow the priority list from the request).
const TARGETS = [
  { code: 'es', native: 'Español',           english_name: 'Spanish',              direction: 'ltr' },
  { code: 'fr', native: 'Français',          english_name: 'French',               direction: 'ltr' },
  { code: 'de', native: 'Deutsch',           english_name: 'German',               direction: 'ltr' },
  { code: 'it', native: 'Italiano',          english_name: 'Italian',              direction: 'ltr' },
  { code: 'pt', native: 'Português',         english_name: 'Portuguese',           direction: 'ltr' },
  { code: 'ru', native: 'Русский',           english_name: 'Russian',              direction: 'ltr' },
  { code: 'tr', native: 'Türkçe',            english_name: 'Turkish',              direction: 'ltr' },
  { code: 'ar', native: 'العربية',           english_name: 'Arabic',               direction: 'rtl' },
  { code: 'hi', native: 'हिन्दी',              english_name: 'Hindi',                direction: 'ltr' },
  { code: 'zh', native: '中文',              english_name: 'Chinese (Simplified)', direction: 'ltr' },
  { code: 'ja', native: '日本語',            english_name: 'Japanese',             direction: 'ltr' },
  { code: 'ko', native: '한국어',            english_name: 'Korean',               direction: 'ltr' },
  { code: 'id', native: 'Bahasa Indonesia',  english_name: 'Indonesian',           direction: 'ltr' },
  { code: 'vi', native: 'Tiếng Việt',        english_name: 'Vietnamese',           direction: 'ltr' },
];

// Google Translate's source-code for Simplified Chinese is 'zh-CN'; we use 'zh'
// as the locale-file name but need to remap when calling the API.
const TL_REMAP = { zh: 'zh-CN' };

// Map English-string -> translated-string per language to avoid re-translating
// duplicates (en.json has ~770 unique values across 794 keys).
function flatten(obj, out, prefix = '') {
  for (const k of Object.keys(obj)) {
    if (k === '_meta') continue;
    const v = obj[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, out, path);
    else out[path] = v;
  }
  return out;
}

function setByPath(obj, dotPath, value) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// Replace {{var}} placeholders with safe ASCII tokens before translation, then
// restore. Google Translate has been observed to preserve uppercase ASCII
// tokens with underscores reliably (much better than {{var}} which sometimes
// gets translated as part of surrounding words).
function protectPlaceholders(s) {
  const placeholders = [];
  let protectedStr = s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, name) => {
    placeholders.push(name);
    return `__PH${placeholders.length - 1}__`;
  });
  // Protect "IRM" (the Irium currency ticker) from translation. Without this
  // Google expands it to "Information Rights Management" in Arabic, and
  // transliterates it to ИРМ / आईआरएम in Russian / Hindi. The marker is
  // intentionally an unambiguous all-caps token that survives translation.
  protectedStr = protectedStr.replace(/\bIRM\b/g, 'IRMTICKER');
  return { protectedStr, placeholders };
}

function restorePlaceholders(s, placeholders) {
  let out = s;
  for (let i = 0; i < placeholders.length; i++) {
    // Be liberal about how Google may have re-cased the marker
    out = out.replace(new RegExp(`__\\s*PH\\s*${i}\\s*__`, 'gi'), `{{${placeholders[i]}}}`);
  }
  // Restore IRM ticker. Match case-insensitively in case Google lowercased.
  out = out.replace(/IRM\s*TICKER/gi, 'IRM');
  return out;
}

// Skip translation for strings that are pure markup/numbers/whitespace.
function isWorthTranslating(s) {
  if (typeof s !== 'string') return false;
  if (s.length < 2) return false;
  if (/^[\d\s.,;:!?@#$%^&*()_+\-=\[\]{}|\\\/<>~`"'’“”—–]+$/u.test(s)) return false;
  return true;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        resolve(data);
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Call Google Translate's unofficial endpoint. Returns the translated string.
// Throws on HTTP errors; caller handles retries.
async function translateOne(text, tl) {
  const sl = 'en';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const body = await httpsGet(url);
  // Response shape: [[[ "translated", "original", null, null, ... ], ...], ...]
  // We concatenate every segment in the first array.
  const json = JSON.parse(body);
  if (!Array.isArray(json) || !Array.isArray(json[0])) {
    throw new Error('Unexpected response shape');
  }
  let out = '';
  for (const segment of json[0]) {
    if (Array.isArray(segment) && typeof segment[0] === 'string') {
      out += segment[0];
    }
  }
  return out;
}

async function translateWithRetry(text, tl, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await translateOne(text, tl);
    } catch (e) {
      lastErr = e;
      // Back off on failure
      await sleep(500 + i * 1000);
    }
  }
  throw lastErr;
}

async function translateLocale(target) {
  const tl = TL_REMAP[target.code] || target.code;
  const enRaw = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, 'en.json'), 'utf-8'));
  const flat = flatten(enRaw, {});
  const uniqueSources = Array.from(new Set(Object.values(flat).filter((s) => typeof s === 'string')));

  console.log(`Translating to ${target.code} (${target.english_name}) — ${uniqueSources.length} unique strings…`);

  const cache = new Map();

  let done = 0;
  for (const src of uniqueSources) {
    done++;
    if (!isWorthTranslating(src)) {
      cache.set(src, src);
      continue;
    }
    const { protectedStr, placeholders } = protectPlaceholders(src);
    try {
      const translatedProtected = await translateWithRetry(protectedStr, tl);
      const restored = restorePlaceholders(translatedProtected, placeholders);
      cache.set(src, restored);
    } catch (e) {
      console.error(`  [${target.code}] FAIL on ${JSON.stringify(src).slice(0, 60)}: ${e.message}`);
      cache.set(src, src); // fall back to English
    }
    if (done % 50 === 0) {
      console.log(`  [${target.code}] ${done}/${uniqueSources.length}`);
    }
    // Small delay to be polite to the endpoint and avoid rate-limits.
    await sleep(80);
  }

  // Build the output locale file
  const out = {
    _meta: {
      status: 'machine_translated',
      review_needed: true,
      language: target.native,
      english_name: target.english_name,
      direction: target.direction,
    },
  };
  // Copy en.json structure but with translations
  function copyWithTranslate(node) {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const r = {};
      for (const k of Object.keys(node)) {
        if (k === '_meta') continue;
        r[k] = copyWithTranslate(node[k]);
      }
      return r;
    }
    if (typeof node === 'string') return cache.get(node) ?? node;
    return node;
  }
  for (const k of Object.keys(enRaw)) {
    if (k === '_meta') continue;
    out[k] = copyWithTranslate(enRaw[k]);
  }
  fs.writeFileSync(
    path.join(LOCALES_DIR, `${target.code}.json`),
    JSON.stringify(out, null, 2) + '\n',
    'utf-8',
  );
  // Stats
  const translatedCount = Array.from(cache.entries()).filter(([k, v]) => k !== v).length;
  console.log(`  [${target.code}] done — ${translatedCount}/${uniqueSources.length} strings translated`);
}

async function main() {
  const enExists = fs.existsSync(path.join(LOCALES_DIR, 'en.json'));
  if (!enExists) {
    console.error('en.json not found');
    process.exit(1);
  }
  // Optionally restrict to a subset of language codes via CLI args:
  //   node translate-locales.js pt ru tr ar hi zh ja ko id vi
  const argv = process.argv.slice(2);
  const filter = argv.length > 0 ? new Set(argv) : null;
  const targets = filter ? TARGETS.filter((t) => filter.has(t.code)) : TARGETS;
  for (const target of targets) {
    try {
      await translateLocale(target);
    } catch (e) {
      console.error(`FATAL for ${target.code}: ${e.message}`);
    }
  }
  console.log('All locales updated.');
}

main();
