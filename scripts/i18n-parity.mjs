#!/usr/bin/env node
/**
 * Verify messages/pt-BR.json and messages/en.json have identical key sets.
 *
 * next-intl falls back silently to the key string at runtime when a
 * translation is missing — so drift is invisible until a user sees
 * `userMenu.notifications` instead of a translated label. This guard
 * catches drift in CI before it lands.
 *
 * Exit 0 if key sets match; exit 1 with a diff listing if they don't.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILES = {
  ptBR: resolve("messages/pt-BR.json"),
  en: resolve("messages/en.json"),
};

function flatten(obj, prefix = "") {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flatten(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function loadKeys(file) {
  const raw = readFileSync(file, "utf8");
  return new Set(flatten(JSON.parse(raw)));
}

const ptKeys = loadKeys(FILES.ptBR);
const enKeys = loadKeys(FILES.en);

const onlyInPt = [...ptKeys].filter((k) => !enKeys.has(k)).sort();
const onlyInEn = [...enKeys].filter((k) => !ptKeys.has(k)).sort();

if (onlyInPt.length === 0 && onlyInEn.length === 0) {
  console.log(`✓ ${ptKeys.size} keys present in both locales`);
  process.exit(0);
}

console.error("✗ i18n key drift detected:");
if (onlyInPt.length > 0) {
  console.error(`\n  Missing in en.json (${onlyInPt.length}):`);
  for (const key of onlyInPt) console.error(`    - ${key}`);
}
if (onlyInEn.length > 0) {
  console.error(`\n  Missing in pt-BR.json (${onlyInEn.length}):`);
  for (const key of onlyInEn) console.error(`    - ${key}`);
}
console.error("\n  Add the missing translations to both files.");

process.exit(1);
