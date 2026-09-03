import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Recurrence guard for the drift found in #307 (issue #308).
 *
 * Pay's catalog carried twelve agency namespaces for the whole life of the
 * monorepo split. Lint sees one file, typecheck sees no strings at all, and
 * the shell contract sees the segment tree — none of them can see "this
 * message file no longer matches the app that owns it". That fact only exists
 * across two artifacts (`messages/*.json` and the app's source), which is
 * exactly the shape tests/shell-contract.test.ts exists to cover.
 *
 * Scoped to `pay` deliberately (#308 § Scope discipline). Widening is a
 * follow-up, and the measured picture is narrower than "every app has
 * orphans": run against the real trees today, agency flags exactly one
 * (`checkout`), while admin and fund come back clean. So widening is one
 * judgement call about one namespace, not a survey. See the PR body.
 */

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const APP = "pay";

const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx"];
const SKIPPED_DIRS: readonly string[] = ["node_modules", ".next", ".turbo", "dist"];

/**
 * Test files are not references. A namespace kept alive only by the suite that
 * asserts on it is still dead copy shipped to users, and mocks routinely name
 * namespaces the app itself no longer renders.
 */
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;

/**
 * The two literal reference forms, per #308.
 *
 * `useTranslations("ns.sub")` / `getTranslations("ns.sub")` is the hook/async
 * form; `getTranslations({ locale, namespace: "ns" })` is the object form
 * layouts and `generateMetadata` use. Both yield a dotted path whose FIRST
 * segment is the top-level catalog key.
 *
 * The object form is anchored to the call, not matched on a bare `namespace:`
 * property. Unanchored, ANY object property named `namespace` counts as a
 * reference — `export const telemetry = { namespace: "notFound" }` anywhere in
 * the scanned tree would keep a genuinely dead `notFound` alive and disarm
 * test A for that key, silently and permanently. `[^{}]*?` spans newlines, so
 * multi-line call sites still resolve; a call built from a variable
 * (`getTranslations(options)`) does not, and that is the safe miss to take —
 * it costs a phantom orphan report, not a silent pass.
 */
const REFERENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:useTranslations|getTranslations)\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\b(?:useTranslations|getTranslations)\s*\(\s*\{[^{}]*?\bnamespace\s*:\s*["'`]([^"'`]+)["'`]/g,
];

/**
 * `useTranslations` alone — the hook whose messages must be in the client
 * bundle. `getTranslations` is server-only and reads the request config, so it
 * never depends on the provider's pick. Feeds test D.
 */
const CLIENT_HOOK_PATTERN = /\buseTranslations\s*\(\s*["'`]([^"'`]+)["'`]/g;

/**
 * `@mutav/<pkg>/<subpath>` specifiers. CLAUDE.md's no-barrel rule makes
 * `packages/<pkg>/src/<subpath>` ↔ `@mutav/<pkg>/<subpath>` one-to-one, the
 * same mapping tests/shell-contract.test.ts resolves for tainted subpaths.
 */
const PACKAGE_IMPORT_PATTERN = /["'`]@mutav\/([a-z0-9-]+)\/([a-zA-Z0-9._/-]+)["'`]/g;

/** Relative specifiers, used to keep walking once inside `packages/`. */
const RELATIVE_IMPORT_PATTERN = /["'`](\.\.?\/[^"'`]+)["'`]/g;

/** The provider pick this app hands to next-intl, as its own module. */
const CLIENT_NAMESPACES_MODULE = join(
  REPO_ROOT,
  "apps",
  APP,
  "src",
  "i18n",
  "client-namespaces.ts",
);

/** Any `<NextIntlClientProvider …>` opening tag, with its attributes. */
const PROVIDER_TAG_PATTERN = /<NextIntlClientProvider(\s[^>]*?)?\/?>/g;

function isFile(absolute: string): boolean {
  try {
    return statSync(absolute).isFile();
  } catch {
    return false;
  }
}

function isDirectory(absolute: string): boolean {
  try {
    return statSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

function walk(dir: string, keep: (name: string) => boolean): string[] {
  if (!isDirectory(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.includes(entry.name)) continue;
      found.push(...walk(join(dir, entry.name), keep));
      continue;
    }
    if (keep(entry.name)) found.push(join(dir, entry.name));
  }
  return found;
}

function repoPath(absolute: string): string {
  return relative(REPO_ROOT, absolute).split(sep).join("/");
}

function readSource(absolute: string): string {
  return readFileSync(absolute, "utf8");
}

function resolveModuleFile(base: string): string | null {
  for (const extension of SOURCE_EXTENSIONS) {
    if (isFile(`${base}${extension}`)) return `${base}${extension}`;
    if (isFile(join(base, `index${extension}`))) return join(base, `index${extension}`);
  }
  return null;
}

/** Every `.ts`/`.tsx` file the app owns, tests excluded. */
function appSources(app: string): string[] {
  return walk(
    join(REPO_ROOT, "apps", app, "src"),
    (name) => SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !TEST_FILE_PATTERN.test(name),
  ).sort();
}

/**
 * Workspace-package modules the app pulls in, followed to a fixed point.
 *
 * This is the whole reason the check cannot be a grep of `apps/<app>/src`.
 * `@mutav/ui/public/public-footer` calls `getTranslations("paymentFlow.shell")`
 * inside packages/, so a scan of pay's own tree would report `paymentFlow` as
 * orphaned.
 *
 * The walk is transitive, not one hop. A one-hop walk breaks in both
 * directions the moment a package component extracts a child: the referring
 * module moves two hops out, test A reports its live namespace as an orphan
 * (and test A's message is advice to delete shipped copy), and test B stops
 * seeing that module's references entirely, so a namespace it renders but the
 * catalog lacks ships as a raw key — the exact failure B exists to catch.
 * Depth is not a property anyone maintains, so it must not be load-bearing.
 *
 * Transitivity over-approximates: a module reachable through the import graph
 * but never rendered still counts. That is deliberate, because the two
 * directions fail asymmetrically. An extra reference makes A quieter (a dead
 * namespace survives one more release); a missing one makes A tell a future
 * dev to delete copy the app renders on every payment page. Only one of those
 * two mistakes is recoverable, so the walk errs toward the quiet one.
 */
function importedPackageModules(sources: readonly string[]): {
  resolved: string[];
  unresolved: string[];
} {
  const resolved = new Set<string>();
  const unresolved = new Set<string>();
  const queue: string[] = [];

  const enqueue = (target: string): void => {
    if (resolved.has(target)) return;
    resolved.add(target);
    queue.push(target);
  };

  const followPackageImports = (file: string, source: string): void => {
    for (const match of source.matchAll(PACKAGE_IMPORT_PATTERN)) {
      const [specifier, pkg, subpath] = match;
      if (specifier === undefined || pkg === undefined || subpath === undefined) continue;
      const target = resolveModuleFile(join(REPO_ROOT, "packages", pkg, "src", subpath));
      if (target === null) unresolved.add(`${repoPath(file)} → ${specifier}`);
      else enqueue(target);
    }
  };

  for (const file of sources) followPackageImports(file, readSource(file));

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined) continue;
    const source = readSource(file);
    followPackageImports(file, source);
    // Relative hops are only followed inside packages/, and a miss is not
    // reported: unlike an `@mutav/*` specifier, a relative string literal is
    // not necessarily an import at all.
    for (const match of source.matchAll(RELATIVE_IMPORT_PATTERN)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const target = resolveModuleFile(join(dirname(file), specifier));
      if (target !== null && !TEST_FILE_PATTERN.test(target)) enqueue(target);
    }
  }

  return { resolved: [...resolved].sort(), unresolved: [...unresolved].sort() };
}

/** Top-level catalog key → the files that reference it. */
function referencesIn(
  files: readonly string[],
  patterns: readonly RegExp[],
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of files) {
    const source = readSource(file);
    for (const pattern of patterns) {
      // Fresh RegExp per file — a shared /g literal carries `lastIndex`.
      for (const match of source.matchAll(new RegExp(pattern.source, "g"))) {
        const path = match[1];
        if (path === undefined) continue;
        const namespace = path.split(".")[0];
        if (namespace === undefined || namespace === "") continue;
        found.set(namespace, [...(found.get(namespace) ?? []), repoPath(file)]);
      }
    }
  }
  return found;
}

/** Repo-relative catalog path → its top-level keys. */
function catalogsOf(app: string): Map<string, string[]> {
  const dir = join(REPO_ROOT, "apps", app, "messages");
  const catalogs = new Map<string, string[]>();
  for (const file of walk(dir, (name) => name.endsWith(".json")).sort()) {
    const parsed: unknown = JSON.parse(readSource(file));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${repoPath(file)} must be a JSON object keyed by namespace`);
    }
    catalogs.set(repoPath(file), Object.keys(parsed).sort());
  }
  if (catalogs.size === 0) {
    throw new Error(
      `apps/${app}/messages holds no catalogs — this gate would pass vacuously; point it at the right directory or delete it`,
    );
  }
  return catalogs;
}

/**
 * The provider pick, read off the module rather than imported: this file is a
 * static survey and `tests/` has no path alias into an app's `src`. A parse
 * that comes back empty throws rather than yielding [], so a rename of the
 * module or the constant reads as its own failure instead of turning test D
 * vacuous.
 */
function clientNamespaces(): string[] {
  if (!isFile(CLIENT_NAMESPACES_MODULE)) {
    throw new Error(
      `${repoPath(CLIENT_NAMESPACES_MODULE)} is missing — test D cannot check the provider pick; update this path if the module moved`,
    );
  }
  const source = readSource(CLIENT_NAMESPACES_MODULE);
  const declaration = /export const CLIENT_NAMESPACES\s*=\s*\[([^\]]*)\]/.exec(source);
  const body = declaration?.[1];
  if (body === undefined) {
    throw new Error(
      `${repoPath(CLIENT_NAMESPACES_MODULE)}: no \`export const CLIENT_NAMESPACES = [...]\` literal — test D would pass vacuously`,
    );
  }
  const names = [...body.matchAll(/["'`]([^"'`]+)["'`]/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  if (names.length === 0) {
    throw new Error(`${repoPath(CLIENT_NAMESPACES_MODULE)}: CLIENT_NAMESPACES is empty`);
  }
  return names;
}

describe(`i18n namespace contract — ${APP}`, () => {
  const sources = appSources(APP);
  const hops = importedPackageModules(sources);
  const scanned = [...sources, ...hops.resolved];
  const references = referencesIn(scanned, REFERENCE_PATTERNS);
  const catalogs = catalogsOf(APP);
  const context = [
    `referenced: ${[...references.keys()].sort().join(", ") || "none"}`,
    `package modules scanned: ${hops.resolved.map((file) => repoPath(file)).join(", ") || "none"}`,
  ].join("\n");

  it("A — every namespace in the catalog is referenced by the app", () => {
    const orphans: string[] = [];
    for (const [catalog, namespaces] of catalogs) {
      for (const namespace of namespaces) {
        if (references.has(namespace)) continue;
        orphans.push(
          `${catalog}: "${namespace}" is reached by no translation call in apps/${APP}/src or the workspace modules it imports — if it is genuinely dead, delete it; if the app renders it through a call this survey cannot see (a namespace built from a variable, a dynamic import), teach the survey instead of deleting the copy`,
        );
      }
    }

    expect(orphans, context).toEqual([]);
  });

  it("B — every namespace the app references exists in the catalog", () => {
    const missing: string[] = [];
    for (const [namespace, callers] of references) {
      for (const [catalog, namespaces] of catalogs) {
        if (namespaces.includes(namespace)) continue;
        missing.push(
          `${catalog}: "${namespace}" is referenced by ${[...new Set(callers)].join(", ")} but absent — next-intl renders that as a raw key at runtime`,
        );
      }
    }

    expect(missing, context).toEqual([]);
  });

  it("C — every shared-package specifier the app imports resolves, so the walk stays whole", () => {
    // Test A's correctness rests entirely on the package walk: a specifier
    // that stops resolving (an exports-map rename, a file moved out of `src/`)
    // silently shrinks the reference set and turns A red against namespaces
    // that are very much alive. That regression must read as its own failure,
    // not as a phantom orphan list. `paymentFlow` is the live example — pay
    // renders @mutav/ui/public/public-footer, which owns `paymentFlow.shell`.
    expect(hops.unresolved, context).toEqual([]);
    expect(hops.resolved.length).toBeGreaterThan(0);
  });

  it("D — every namespace a client component translates is in the provider pick", () => {
    // B proves a namespace exists in the catalog; it does not prove the
    // namespace reaches the browser. Since #307 the layout hands
    // NextIntlClientProvider a hand-maintained subset, so a client component
    // that starts translating a namespace outside that list renders a raw key
    // for users while A, B and C all stay green — the catalog is intact, the
    // pick is not. Nothing in the type system connects the two lists.
    const pick = clientNamespaces();
    const hookReferences = referencesIn(scanned, [CLIENT_HOOK_PATTERN]);

    const uncovered: string[] = [];
    for (const [namespace, callers] of hookReferences) {
      if (pick.includes(namespace)) continue;
      uncovered.push(
        `"${namespace}" is translated in the browser by ${[...new Set(callers)].join(", ")} but is not in CLIENT_NAMESPACES (${repoPath(CLIENT_NAMESPACES_MODULE)}) — next-intl has no messages for it on the client, so every string renders as a raw key`,
      );
    }

    // A pick entry the catalog lacks serializes `undefined` under that key.
    const unbacked: string[] = [];
    for (const [catalog, namespaces] of catalogs) {
      for (const namespace of pick) {
        if (namespaces.includes(namespace)) continue;
        unbacked.push(
          `${catalog}: CLIENT_NAMESPACES names "${namespace}", which the catalog does not define`,
        );
      }
    }

    expect([...uncovered, ...unbacked], `pick: ${pick.join(", ")}\n${context}`).toEqual([]);
  });

  it("E — every NextIntlClientProvider passes messages explicitly", () => {
    // `messages` left undefined is not "no messages": next-intl's server
    // provider falls back to `await getMessages()` and inlines the entire
    // catalog into that page's HTML. That is the #307 leak itself, and it is
    // invisible to A–D, which only ever compare namespace names. The root 404
    // is the route that had it: it replaces the layout, so it re-declares its
    // own provider and inherited the default.
    const violations: string[] = [];
    for (const file of sources) {
      for (const match of readSource(file).matchAll(PROVIDER_TAG_PATTERN)) {
        if ((match[1] ?? "").includes("messages")) continue;
        violations.push(
          `${repoPath(file)}: <NextIntlClientProvider> with no \`messages\` prop — next-intl defaults to getMessages() and serializes the whole catalog into this route's HTML; pass the pick, or {} if nothing under it translates in the browser`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
