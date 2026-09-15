import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CLOSE_REASONS, GUARANTEE_STATES } from "@convex/guarantees/machine";
import { TENANT_FIELD_VALIDATION_CODES, WIZARD_VALIDATION_CODES } from "./wizard";

/**
 * The guarantee state and close reason are rendered by dynamic key lookup —
 * `t(state)` and `t(\`closeReason.${reason}\`)` — so neither TypeScript nor
 * next-intl can tell that a catalog is missing one. A missing key renders as
 * the raw literal (`in_arrears`) in front of an agency. That fact only exists
 * across three artifacts: the machine's state set, the two message catalogs,
 * and the agency source. This is the gate that compares them.
 *
 * Test C mirrors tests/i18n-namespace-contract.test.ts (pay) one level deeper:
 * that gate compares top-level namespaces, this one compares leaf keys inside
 * the three namespaces this refactor renamed.
 */

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const APP_SOURCE = join(REPO_ROOT, "apps", "agency", "src");
const MESSAGES = join(REPO_ROOT, "apps", "agency", "messages");

const LOCALES: readonly string[] = ["pt-BR", "en"];

/** The namespaces PR4 renamed off `contract*`. Leaf-orphan scope for test C. */
const SCOPED_NAMESPACES: readonly string[] = ["guaranteeDetails", "guaranteeList", "guaranteeNew"];

const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx"];
const SKIPPED_DIRS: readonly string[] = ["node_modules", ".next", ".turbo", "dist"];
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;

/**
 * `const t = useTranslations("ns")`, its `await getTranslations` twin, and the
 * object form layouts use. Group 1 is the local name, group 2 the namespace.
 */
const CONST_BINDING =
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*(?:\{[^{}]*?\bnamespace\s*:\s*)?["'`]([^"'`]+)["'`]/g;

/**
 * A translator passed into a helper, typed as
 * `t: ReturnType<typeof useTranslations<"ns">>`. `buildColumns` in
 * guarantee-list-table.tsx is the live case; without this the whole
 * `guaranteeList.columns` group reads as orphaned.
 */
const PARAM_BINDING =
  /\b([A-Za-z_$][\w$]*)\s*:\s*ReturnType<\s*typeof\s+(?:useTranslations|getTranslations)\s*<\s*["'`]([^"'`]+)["'`]/g;

type Catalog = Record<string, unknown>;

function isRecord(value: unknown): value is Catalog {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectory(absolute: string): boolean {
  try {
    return statSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

function walk(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.includes(entry.name)) continue;
      found.push(...walk(join(dir, entry.name)));
      continue;
    }
    if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    if (TEST_FILE_PATTERN.test(entry.name)) continue;
    found.push(join(dir, entry.name));
  }
  return found;
}

function repoPath(absolute: string): string {
  return relative(REPO_ROOT, absolute).split(sep).join("/");
}

function readCatalog(locale: string): Catalog {
  const parsed: unknown = JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), "utf8"));
  if (!isRecord(parsed)) throw new Error(`apps/agency/messages/${locale}.json is not an object`);
  return parsed;
}

/** Dotted leaf paths of every string in the catalog, rooted at `prefix`. */
function leafPaths(value: unknown, prefix: string): string[] {
  if (!isRecord(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, `${prefix}.${key}`));
}

function labelAt(catalog: Catalog, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (node, key) => (isRecord(node) ? node[key] : undefined),
    catalog as unknown,
  );
}

function nonEmptyLabels(
  catalog: Catalog,
  group: readonly string[],
  keys: readonly string[],
  locale: string,
): string[] {
  const problems: string[] = [];
  const node = labelAt(catalog, group);
  const groupPath = group.join(".");
  if (!isRecord(node)) {
    return [`${locale}: "${groupPath}" is missing or is not an object`];
  }
  for (const key of keys) {
    const label = node[key];
    if (typeof label !== "string" || label.trim() === "") {
      problems.push(
        `${locale}: "${groupPath}.${key}" has no label — next-intl renders the raw key "${key}" to the user`,
      );
    }
  }
  const extra = Object.keys(node).filter((key) => !keys.includes(key));
  for (const key of extra) {
    problems.push(
      `${locale}: "${groupPath}.${key}" labels a value the domain no longer has — delete it`,
    );
  }
  return problems;
}

/**
 * Every catalog key the agency source can reach, as exact paths plus prefixes.
 * A prefix covers a dynamic lookup: `t(\`errors.${code}\`)` under namespace
 * `guaranteeNew.review` yields the prefix `guaranteeNew.review.errors.`, and
 * `tState(status)` — a bare expression argument — yields the whole namespace.
 */
function referencedKeys(files: readonly string[]): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes = new Set<string>();

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // One local name can be bound twice in a file — `generateMetadata` and the
    // page component both call their translator `t`, under `ns.meta` and `ns`.
    // A call is credited to every namespace that name carries: the survey
    // cannot tell the two scopes apart, and over-crediting only lets a dead key
    // survive, while under-crediting tells the next reader to delete live copy.
    const bindings = new Map<string, Set<string>>();
    for (const pattern of [CONST_BINDING, PARAM_BINDING]) {
      for (const match of source.matchAll(new RegExp(pattern.source, "g"))) {
        const [, name, namespace] = match;
        if (name === undefined || namespace === undefined) continue;
        bindings.set(name, (bindings.get(name) ?? new Set()).add(namespace));
      }
    }

    for (const [name, namespaces] of bindings) {
      const call = `\\b${name}(?:\\.(?:has|rich|markup|raw))?\\s*\\(\\s*`;
      const literals = [...source.matchAll(new RegExp(`${call}["'\`]([^"'\`$]+)["'\`]`, "g"))]
        .map((match) => match[1])
        .filter((key): key is string => key !== undefined);
      const dynamic = [...source.matchAll(new RegExp(`${call}\`([^\`$]*)\\$\\{`, "g"))]
        .map((match) => match[1])
        .filter((key): key is string => key !== undefined);
      // A bare expression argument (`tState(status)`) resolves at runtime to
      // any key under the namespace, so the whole namespace counts as reached.
      const wholeNamespace = new RegExp(`${call}[A-Za-z_$]`).test(source);

      for (const namespace of namespaces) {
        for (const key of literals) exact.add(`${namespace}.${key}`);
        for (const key of dynamic) prefixes.add(`${namespace}.${key}`);
        if (wholeNamespace) prefixes.add(`${namespace}.`);
      }
    }
  }

  return { exact, prefixes: [...prefixes] };
}

describe("guarantee state labels", () => {
  const catalogs = new Map(LOCALES.map((locale) => [locale, readCatalog(locale)]));

  it("A — every guarantee state, close reason and validation code is labeled in both locales", () => {
    const problems = LOCALES.flatMap((locale) => {
      const catalog = catalogs.get(locale);
      if (catalog === undefined) throw new Error(`no catalog for ${locale}`);
      return [
        ...nonEmptyLabels(catalog, ["guaranteeDetails", "state"], GUARANTEE_STATES, locale),
        ...nonEmptyLabels(catalog, ["guaranteeDetails", "closeReason"], CLOSE_REASONS, locale),
        ...nonEmptyLabels(
          catalog,
          ["guaranteeList", "tabs"],
          ["all", "expiring", ...GUARANTEE_STATES],
          locale,
        ),
        // Test C credits the whole `guaranteeNew.validation.` subtree to the
        // template-literal call in step 4, so a code the wizard dropped stays
        // invisible there. Compared against the code list, it cannot.
        ...nonEmptyLabels(
          catalog,
          ["guaranteeNew", "validation"],
          [...WIZARD_VALIDATION_CODES, ...TENANT_FIELD_VALIDATION_CODES],
          locale,
        ),
      ];
    });

    expect(problems).toEqual([]);
  });

  it("B — both locales define the same keys under the renamed namespaces", () => {
    const [first, ...rest] = LOCALES;
    if (first === undefined) throw new Error("LOCALES is empty — this gate would pass vacuously");
    const reference = catalogs.get(first);
    if (reference === undefined) throw new Error(`no catalog for ${first}`);

    const pathsOf = (catalog: Catalog): string[] =>
      SCOPED_NAMESPACES.flatMap((namespace) => leafPaths(catalog[namespace], namespace)).sort();

    const expected = pathsOf(reference);
    expect(expected.length).toBeGreaterThan(0);

    const drift: string[] = [];
    for (const locale of rest) {
      const catalog = catalogs.get(locale);
      if (catalog === undefined) throw new Error(`no catalog for ${locale}`);
      const actual = new Set(pathsOf(catalog));
      for (const path of expected) {
        if (!actual.has(path)) drift.push(`${locale}: missing "${path}" (present in ${first})`);
      }
      for (const path of actual) {
        if (!expected.includes(path)) drift.push(`${locale}: extra "${path}" (absent in ${first})`);
      }
    }

    expect(drift).toEqual([]);
  });

  it("C — no key under the renamed namespaces is orphaned", () => {
    const files = walk(APP_SOURCE);
    expect(files.length).toBeGreaterThan(0);

    const { exact, prefixes } = referencedKeys(files);
    const catalog = catalogs.get("pt-BR");
    if (catalog === undefined) throw new Error("no pt-BR catalog");

    const orphans = SCOPED_NAMESPACES.flatMap((namespace) =>
      leafPaths(catalog[namespace], namespace),
    ).filter((path) => !exact.has(path) && !prefixes.some((prefix) => path.startsWith(prefix)));

    expect(orphans, `scanned ${files.length} files under ${repoPath(APP_SOURCE)}`).toEqual([]);
  });
});
