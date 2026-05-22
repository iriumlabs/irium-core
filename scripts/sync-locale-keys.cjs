// One-off i18n key-sync utility (FIX 7).
// Walks en.json and for every key path that does not exist in a non-English
// locale, copies the English value as a fallback so the UI never renders a
// raw i18next key when a new string ships before translation. Existing
// translations are preserved exactly. Run once after adding new keys, then
// review the diff per locale before commit.

const fs = require('fs');
const path = require('path');

const LOCALE_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const enPath = path.join(LOCALE_DIR, 'en.json');
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

const otherLocales = fs.readdirSync(LOCALE_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'en.json');

// Recursively merge `enNode` into `targetNode`, adding only keys that are
// missing. Returns the count of keys added so the caller can report a
// summary. Never overwrites an existing string in target.
function mergeMissing(targetNode, enNode, locale, breadcrumb) {
  let added = 0;
  for (const key of Object.keys(enNode)) {
    const enValue = enNode[key];
    const here = breadcrumb ? `${breadcrumb}.${key}` : key;
    if (typeof enValue === 'object' && enValue !== null && !Array.isArray(enValue)) {
      if (typeof targetNode[key] !== 'object' || targetNode[key] === null || Array.isArray(targetNode[key])) {
        targetNode[key] = {};
      }
      added += mergeMissing(targetNode[key], enValue, locale, here);
    } else {
      if (!(key in targetNode)) {
        targetNode[key] = enValue;
        added += 1;
        console.log(`  + ${locale}: ${here}`);
      }
    }
  }
  return added;
}

let totalAdded = 0;
for (const file of otherLocales) {
  const locale = path.basename(file, '.json');
  const fullPath = path.join(LOCALE_DIR, file);
  const target = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const added = mergeMissing(target, en, locale, '');
  if (added > 0) {
    fs.writeFileSync(fullPath, JSON.stringify(target, null, 2) + '\n', 'utf8');
    console.log(`${locale}: added ${added} key(s)`);
  } else {
    console.log(`${locale}: no missing keys`);
  }
  totalAdded += added;
}
console.log(`Total keys added across ${otherLocales.length} locales: ${totalAdded}`);
