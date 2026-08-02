#!/usr/bin/env node
/**
 * Verify every app's messages/pt-BR.json and messages/en.json have identical
 * key sets.
 *
 * next-intl falls back silently to the key string at runtime when a
 * translation is missing — so drift is invisible until a user sees
 * `userMenu.notifications` instead of a translated label. This guard
 * catches drift in CI before it lands.
 *
 * Apps are read from disk, not listed: a fifth persona app would otherwise
 * ship its messages with no parity gate at all.
 *
 * Exit 0 if every app's key sets match; exit 1 with a diff listing if any don't.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const APPS_ROOT = resolve("apps");

function messageFilesOf(app) {
  const dir = join(APPS_ROOT, app, "messages");
  const files = { ptBR: join(dir, "pt-BR.json"), en: join(dir, "en.json") };
  for (const file of Object.values(files)) {
    try {
      if (!statSync(file).isFile()) return null;
    } catch {
      return null;
    }
  }
  return files;
}

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
  return new Set(flatten(JSON.parse(readFileSync(file, "utf8"))));
}

const apps = readdirSync(APPS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let drifted = false;

for (const app of apps) {
  const files = messageFilesOf(app);
  if (files === null) {
    console.error(`✗ ${app}: missing messages/pt-BR.json or messages/en.json`);
    drifted = true;
    continue;
  }

  const ptKeys = loadKeys(files.ptBR);
  const enKeys = loadKeys(files.en);
  const onlyInPt = [...ptKeys].filter((key) => !enKeys.has(key)).sort();
  const onlyInEn = [...enKeys].filter((key) => !ptKeys.has(key)).sort();

  if (onlyInPt.length === 0 && onlyInEn.length === 0) {
    console.log(`✓ ${app}: ${ptKeys.size} keys present in both locales`);
    continue;
  }

  drifted = true;
  console.error(`✗ ${app}: i18n key drift detected:`);
  if (onlyInPt.length > 0) {
    console.error(`\n  Missing in ${app}/messages/en.json (${onlyInPt.length}):`);
    for (const key of onlyInPt) console.error(`    - ${key}`);
  }
  if (onlyInEn.length > 0) {
    console.error(`\n  Missing in ${app}/messages/pt-BR.json (${onlyInEn.length}):`);
    for (const key of onlyInEn) console.error(`    - ${key}`);
  }
  console.error("\n  Add the missing translations to both files.");
}

process.exit(drifted ? 1 : 0);
