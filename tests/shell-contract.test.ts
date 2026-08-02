import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Structural gate for the three-shell contract (docs/architecture/nav-shell-audit.md § 4).
 *
 * This is the only check that can detect ABSENCE. ESLint sees one file at a
 * time, so "this route group has no shell at all" is invisible to it — the
 * fact lives in the App Router segment tree, not in any single file. Most
 * assertions here are string scans over that tree; the chrome check parses,
 * because "extract the header into a component" is the one refactor a
 * text scan cannot follow.
 */

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * Read from disk, not listed. A hardcoded roster lets a fifth persona app be
 * born entirely outside this contract — no shell anywhere, no not-found.tsx,
 * board still green — and docs/architecture/README.md § App catalog actively
 * anticipates new apps.
 */
const APPS: readonly string[] = readdirSync(join(REPO_ROOT, "apps"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * Segment files that WRAP children, so a shell mounted in one covers the
 * subtree. `template.tsx` is a first-class route file that wraps every page in
 * its segment exactly like a layout; omitting it would make a second nav bar
 * (or a second shell) inside an existing shell invisible to every gate.
 */
const WRAPPER_FILE_NAMES: readonly string[] = ["layout.tsx", "template.tsx"];

/** Segment files that render a route's own UI and therefore need a shell above them. */
const LEAF_FILE_NAMES: readonly string[] = ["page.tsx", "default.tsx"];

/**
 * Files Next mounts as segment-level chrome hosts. Mirrors the
 * `no-restricted-syntax` glob in eslint.config.mjs — the two must agree, or a
 * file is chrome-checked by one gate and not the other.
 */
const CHROME_OWNER_FILE_NAMES: readonly string[] = ["layout.tsx", "template.tsx", "default.tsx"];

const ROUTE_FILE_NAMES: readonly string[] = [
  ...new Set([...WRAPPER_FILE_NAMES, ...LEAF_FILE_NAMES, "not-found.tsx"]),
];

const SHELL_IMPORT_SOURCE = String.raw`from\s+["']@mutav/ui/shell/(app-shell|flow-shell|bare-shell)["']`;

/**
 * Chrome ingredients a shell composes internally. A route file importing one
 * is hand-rolling chrome that a shell already owns.
 * `@mutav/ui/public/public-footer` is deliberately absent: FlowShell takes the
 * footer as a slot, so its consumers must import it.
 */
const INGREDIENTS: readonly string[] = [
  "@mutav/ui/sidebar",
  "@mutav/ui/public/public-shell",
  "@mutav/ui/sonner",
];

/** Landmark elements a shell owns. A route wrapper rendering one is a second shell in disguise. */
const CHROME_TAGS: readonly string[] = ["header", "nav", "aside", "footer"];
const CHROME_TAG_PATTERN = /<(header|nav|aside|footer)[\s/>]/;

const EXEMPT_LAYOUTS_FILE = "tests/shell-exempt-layouts.json";

/**
 * A route group whose layout arranges its own chrome instead of mounting a
 * shell. Every entry carries its own `reason` and `tracking` so the rationale
 * travels with the data: the entry IS the record, not a comment next to it that
 * the next editor never reads. An entry with no justification cannot be added
 * without the schema rejecting it.
 */
type ExemptLayout = { reason: string; tracking: string };

function isExemptLayout(value: unknown): value is ExemptLayout {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record.reason === "string" &&
    record.reason.trim().length >= 40 &&
    typeof record.tracking === "string" &&
    record.tracking.trim().length >= 20
  );
}

function loadExemptLayouts(): ReadonlyMap<string, ExemptLayout> {
  let raw: string;
  try {
    raw = readFileSync(join(REPO_ROOT, EXEMPT_LAYOUTS_FILE), "utf8");
  } catch {
    // Without this the module-scope read throws a bare ENOENT and takes down
    // every `it` in the file — a shell-contract failure must read as one.
    throw new Error(
      `${EXEMPT_LAYOUTS_FILE} is missing. It is the shell contract's only exemption list and is read by both this gate and .claude/hooks/shell-contract.js — commit it, or delete both readers.`,
    );
  }

  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${EXEMPT_LAYOUTS_FILE} must be an object keyed by repo-relative layout path`);
  }

  const entries = new Map<string, ExemptLayout>();
  for (const [path, value] of Object.entries(parsed)) {
    if (!isExemptLayout(value)) {
      throw new Error(
        `${EXEMPT_LAYOUTS_FILE}: "${path}" needs a substantive "reason" and a "tracking" reference — an exemption without a justification is a silently softened check`,
      );
    }
    entries.set(path, value);
  }
  return entries;
}

const EXEMPT_LAYOUTS: ReadonlyMap<string, ExemptLayout> = loadExemptLayouts();
const SHELL_EXEMPT_LAYOUTS: readonly string[] = [...EXEMPT_LAYOUTS.keys()];

const SCANNABLE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
];
const MODULE_EXTENSIONS: readonly string[] = [".tsx", ".ts"];
const SKIPPED_DIRS: readonly string[] = ["node_modules", ".next", ".turbo", "dist"];

function localeRootOf(app: string): string {
  return join(REPO_ROOT, "apps", app, "src", "app", "[locale]");
}

function appRootOf(app: string): string {
  return join(REPO_ROOT, "apps", app, "src", "app");
}

function repoPath(absolute: string): string {
  return relative(REPO_ROOT, absolute).split(sep).join("/");
}

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

function collectRouteFiles(app: string): string[] {
  return walk(localeRootOf(app), (name) => ROUTE_FILE_NAMES.includes(name)).sort();
}

function filesNamed(app: string, names: readonly string[]): string[] {
  return collectRouteFiles(app).filter((file) =>
    names.includes(file.split(sep).slice(-1)[0] ?? ""),
  );
}

/**
 * Every file of that name anywhere under `src/app/`, not just under `[locale]`.
 * The positional 404 rules are about paths Next treats specially, and both of
 * the paths they reject (`src/app/not-found.tsx`, a stray
 * `[locale]/global-not-found.tsx`) sit outside the `[locale]` route walk.
 */
function everyFileNamed(app: string, name: string): string[] {
  return walk(appRootOf(app), (entry) => entry === name).sort();
}

function readSource(absolute: string): string {
  return readFileSync(absolute, "utf8");
}

function parseTsx(absolute: string): ts.SourceFile {
  return ts.createSourceFile(
    absolute,
    readSource(absolute),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** Fresh RegExp per call — a shared /g literal carries `lastIndex` between scans. */
function shellImportsIn(absolute: string): string[] {
  const matches = readSource(absolute).matchAll(new RegExp(SHELL_IMPORT_SOURCE, "g"));
  return [...matches].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

function resolveModuleFile(base: string): string | null {
  for (const extension of MODULE_EXTENSIONS) {
    if (isFile(`${base}${extension}`)) return `${base}${extension}`;
    if (isFile(join(base, `index${extension}`))) return join(base, `index${extension}`);
  }
  return null;
}

function resolveRelativeImport(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return resolveModuleFile(join(fromFile, "..", specifier));
}

/** Resolves `@/…` (the app's own `src/`) and relative specifiers. Anything else is a package. */
function resolveAppImport(specifier: string, fromFile: string, app: string): string | null {
  if (specifier.startsWith("@/")) {
    return resolveModuleFile(join(REPO_ROOT, "apps", app, "src", specifier.slice(2)));
  }
  return resolveRelativeImport(specifier, fromFile);
}

type ImportBinding = { localName: string; specifier: string };

function importBindingsOf(source: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) bindings.push({ localName: clause.name.text, specifier });
    const named = clause.namedBindings;
    if (named !== undefined && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        bindings.push({ localName: element.name.text, specifier });
      }
    }
  }
  return bindings;
}

/**
 * JSX elements a file renders as CHILDREN, i.e. not as a prop value. The
 * distinction is the whole contract: `<AppShell nav={<AgencyNav />}>` hands a
 * nav to the shell (fine), while rendering `<AgencyNav />` beside `{children}`
 * mounts a second navigation the shell knows nothing about.
 */
function childPositionElements(source: ts.SourceFile): string[] {
  const tags: string[] = [];

  function visit(node: ts.Node, insideAttribute: boolean): void {
    const nowInsideAttribute = insideAttribute || ts.isJsxAttribute(node);
    if (!nowInsideAttribute && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
      tags.push(node.tagName.getText(source));
    }
    node.forEachChild((child) => visit(child, nowInsideAttribute));
  }

  visit(source, false);
  return [...new Set(tags)];
}

/**
 * Chrome a route wrapper mounts, inline or one hop away.
 *
 * ESLint bans the landmark tags in these files, but the ban survives only
 * until someone extracts the markup into `src/components/` — which is
 * deliberately unscoped so nav components can hold a real `<nav>`. So the
 * check follows the wrapper's own app-local imports ONE hop and re-reads
 * them. One hop, not transitive: the refactor being closed is "move it next
 * door", and a wrapper is a handful of lines by construction.
 */
function chromeMountedBy(absolute: string, app: string): string[] {
  const source = parseTsx(absolute);
  const localByTag = new Map<string, string>();
  for (const binding of importBindingsOf(source)) {
    const resolved = resolveAppImport(binding.specifier, absolute, app);
    if (resolved !== null) localByTag.set(binding.localName, resolved);
  }

  const violations: string[] = [];
  for (const tag of childPositionElements(source)) {
    if (CHROME_TAGS.includes(tag)) {
      violations.push(
        `${repoPath(absolute)} renders <${tag}> directly — that landmark belongs to a shell in @mutav/ui/shell/*`,
      );
      continue;
    }
    const local = localByTag.get(tag);
    if (local === null || local === undefined) continue;
    if (!CHROME_TAG_PATTERN.test(readSource(local))) continue;
    violations.push(
      `${repoPath(absolute)} renders <${tag} /> as a child and ${repoPath(local)} hand-rolls a landmark — pass it to a shell slot instead`,
    );
  }
  return violations;
}

/**
 * `@mutav/<pkg>/<subpath>` specifiers whose implementation reaches `@auth0`.
 *
 * Path-derived: CLAUDE.md's no-barrel rule makes `packages/<pkg>/src/<name>`
 * ↔ `@mutav/<pkg>/<name>` one-to-one. Relative imports are followed so a
 * clean-looking subpath that re-exports a tainted sibling still counts.
 */
function auth0TaintedSpecifiers(): string[] {
  const packagesRoot = join(REPO_ROOT, "packages");
  const tainted: string[] = [];

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const srcRoot = join(packagesRoot, entry.name, "src");
    const sources = walk(srcRoot, (name) => MODULE_EXTENSIONS.some((ext) => name.endsWith(ext)));

    for (const file of sources) {
      const seen = new Set<string>();
      const queue = [file];
      let reaches = false;
      while (queue.length > 0) {
        const current = queue.pop();
        if (current === undefined || seen.has(current)) continue;
        seen.add(current);
        const text = readSource(current);
        if (text.includes("@auth0")) {
          reaches = true;
          break;
        }
        for (const binding of importBindingsOf(parseTsx(current))) {
          const resolved = resolveRelativeImport(binding.specifier, current);
          if (resolved !== null) queue.push(resolved);
        }
      }
      if (!reaches) continue;
      const subpath = relative(srcRoot, file)
        .split(sep)
        .join("/")
        .replace(/\.(tsx|ts)$/, "");
      tainted.push(`@mutav/${entry.name}/${subpath}`);
    }
  }

  return tainted.sort();
}

/**
 * Wrappers that enclose `leafFile`, innermost first, EXCLUDING
 * `[locale]/layout.tsx`. The root layout owns <html>/<body>/fonts/
 * NextIntlClientProvider in every app and will never import a shell; counting
 * it would start this check red. A root `template.tsx` is NOT excused — it has
 * no such job.
 */
function shellChainOf(leafFile: string, app: string, wrappers: readonly string[]): string[] {
  const rootLayout = join(localeRootOf(app), "layout.tsx");
  const leafDir = join(leafFile, "..");
  return wrappers
    .filter((wrapper) => {
      if (wrapper === rootLayout) return false;
      const wrapperDir = join(wrapper, "..");
      return leafDir === wrapperDir || leafDir.startsWith(wrapperDir + sep);
    })
    .sort((a, b) => b.length - a.length);
}

type RouteRow = {
  app: string;
  route: string;
  shell: string;
  problem: string | null;
};

function routeLabelOf(leafFile: string, app: string): string {
  const rel = relative(localeRootOf(app), leafFile).split(sep).join("/");
  const withoutFile = rel.replace(/\/?(page|default|not-found)\.tsx$/, "");
  return withoutFile === "" ? "/" : `/${withoutFile}`;
}

function buildRouteRows(): RouteRow[] {
  const rows: RouteRow[] = [];

  for (const app of APPS) {
    const wrappers = filesNamed(app, WRAPPER_FILE_NAMES);
    const leaves = filesNamed(app, LEAF_FILE_NAMES);

    for (const leaf of leaves) {
      const chain = shellChainOf(leaf, app, wrappers);
      const exempt = chain.find((wrapper) => SHELL_EXEMPT_LAYOUTS.includes(repoPath(wrapper)));
      if (exempt !== undefined) {
        rows.push({ app, route: routeLabelOf(leaf, app), shell: "EXEMPT", problem: null });
        continue;
      }

      const fromWrappers = chain.flatMap((wrapper) =>
        shellImportsIn(wrapper).map((shell) => ({ shell, source: repoPath(wrapper) })),
      );
      // A leaf may own its shell only when no ancestor wrapper supplies one —
      // `admin/access-denied` is the whole reason this branch exists.
      const fromLeaf = shellImportsIn(leaf).map((shell) => ({ shell, source: repoPath(leaf) }));
      const resolved = [...fromWrappers, ...fromLeaf];

      if (resolved.length === 0) {
        rows.push({
          app,
          route: routeLabelOf(leaf, app),
          shell: "NONE",
          problem:
            "no shell in the segment chain — add a shell from @mutav/ui/shell/* to the route-group layout",
        });
        continue;
      }
      if (resolved.length > 1) {
        rows.push({
          app,
          route: routeLabelOf(leaf, app),
          shell: resolved.map((entry) => entry.shell).join(" + "),
          problem: `nested shells: ${resolved.map((entry) => `${entry.shell} @ ${entry.source}`).join(", ")}`,
        });
        continue;
      }

      rows.push({
        app,
        route: routeLabelOf(leaf, app),
        shell: resolved[0]?.shell ?? "NONE",
        problem: null,
      });
    }
  }

  return rows;
}

function renderTable(rows: readonly RouteRow[]): string {
  const appWidth = Math.max(...rows.map((row) => row.app.length), 3);
  const routeWidth = Math.max(...rows.map((row) => row.route.length), 5);
  const header = `${"app".padEnd(appWidth)} | ${"route".padEnd(routeWidth)} | resolved shell`;
  const body = rows.map((row) => {
    const mark = row.problem === null ? "" : `  <-- ${row.problem}`;
    return `${row.app.padEnd(appWidth)} | ${row.route.padEnd(routeWidth)} | ${row.shell}${mark}`;
  });
  return [header, "-".repeat(header.length), ...body].join("\n");
}

describe("shell contract", () => {
  const rows = buildRouteRows();
  const table = `\n${renderTable(rows)}\n`;

  it("A — every route resolves to exactly one shell", () => {
    const violations = rows
      .filter((row) => row.problem !== null)
      .map((row) => `${row.app} ${row.route}: ${row.problem}`);

    expect(violations, table).toEqual([]);
  });

  it("B1 — each app has a global 404 at src/app/global-not-found.tsx, on BareShell, with the flag on", () => {
    const violations: string[] = [];

    for (const app of APPS) {
      if (!isDirectory(localeRootOf(app))) {
        violations.push(
          `${app}: no src/app/[locale] route root — every app under apps/ is a Next app`,
        );
        continue;
      }

      // An unmatched URL never reaches [locale]/not-found.tsx: Next resolves
      // /_not-found against the app-dir ROOT, so the rewrite into [locale]
      // changes the pathname, not the boundary. See nav-shell-audit § 5.
      const globalNotFound = join(appRootOf(app), "global-not-found.tsx");
      // Next reads this convention at the app-dir root ONLY. A copy written one
      // segment down is not a 404 at all — it is an inert module, and every
      // import-based assertion below would happily pass on it.
      for (const stray of everyFileNamed(app, "global-not-found.tsx")) {
        if (stray === globalNotFound) continue;
        violations.push(
          `${repoPath(stray)}: global-not-found.tsx is an app-dir-root convention — Next ignores it here; move it to ${repoPath(globalNotFound)}`,
        );
      }
      if (!isFile(globalNotFound)) {
        violations.push(
          `${app}: no src/app/global-not-found.tsx — unmatched URLs would fall to Next's builtin 404`,
        );
      } else {
        const shells = shellImportsIn(globalNotFound);
        if (shells.length !== 1 || shells[0] !== "bare-shell") {
          violations.push(
            `${repoPath(globalNotFound)}: must import exactly @mutav/ui/shell/bare-shell (found: ${shells.join(", ") || "none"})`,
          );
        }
        const source = readSource(globalNotFound);
        // It replaces the root layout for /_not-found, so it owns the document.
        if (!source.includes("<html") || !source.includes("<body")) {
          violations.push(
            `${repoPath(globalNotFound)}: must return a full document — <html> and <body> with the same classes as [locale]/layout.tsx`,
          );
        }
      }

      // Without the flag, next-app-loader deletes the convention and the file
      // above is a silent no-op. That is this change's worst failure mode.
      const config = join(REPO_ROOT, "apps", app, "next.config.ts");
      if (!isFile(config) || !/globalNotFound:\s*true/.test(readSource(config))) {
        violations.push(
          `apps/${app}/next.config.ts: set experimental.globalNotFound: true, or global-not-found.tsx is ignored`,
        );
      }
    }

    expect(violations, table).toEqual([]);
  });

  it("B2 — each app has exactly one not-found.tsx, at [locale]/, on BareShell", () => {
    const violations: string[] = [];

    for (const app of APPS) {
      if (!isDirectory(localeRootOf(app))) continue;

      // Whole app dir, not just [locale]: `src/app/not-found.tsx` and
      // `src/app/(public)/not-found.tsx` are both wrong and both invisible to
      // a walk rooted at [locale].
      const notFounds = everyFileNamed(app, "not-found.tsx");
      const expected = join(localeRootOf(app), "not-found.tsx");
      const appRootNotFound = join(appRootOf(app), "not-found.tsx");

      if (notFounds.length === 0) {
        violations.push(
          `${app}: no [locale]/not-found.tsx (D5 — the notFound() boundary, on BareShell)`,
        );
        continue;
      }
      for (const found of notFounds) {
        if (found === expected) continue;
        if (found === appRootNotFound) {
          // In THIS repo the app dir has no `layout.tsx` — the root layout is
          // `[locale]/layout.tsx` — so Next has no root layout to wrap a root
          // not-found in and supplies a builtin <html><body> with no lang, no
          // font variable and no theme class. BareShell collapses inside it.
          // (Repo-specific: an app with a static root layout would not see this.)
          violations.push(
            `${repoPath(found)}: this app's root layout is [locale]/layout.tsx, so a root not-found renders under Next's builtin document — use ${repoPath(join(appRootOf(app), "global-not-found.tsx"))} for unmatched URLs`,
          );
          continue;
        }
        // A nested not-found.tsx imports BareShell, satisfies every
        // import-based check, and still renders inside its group's sidebar.
        // Only its PATH reveals the bug.
        violations.push(
          `${repoPath(found)}: nested not-found renders inside its group's shell — move it to ${repoPath(expected)}`,
        );
      }
      // Guard the read: without it, a misplaced not-found makes this test throw
      // ENOENT instead of reporting the violation it was written for.
      if (!isFile(expected)) continue;
      const shells = shellImportsIn(expected);
      if (shells.length !== 1 || shells[0] !== "bare-shell") {
        violations.push(
          `${repoPath(expected)}: must import exactly @mutav/ui/shell/bare-shell (found: ${shells.join(", ") || "none"})`,
        );
      }
    }

    expect(violations, table).toEqual([]);
  });

  it("C — no route wrapper imports a chrome ingredient or mounts its own chrome", () => {
    const violations: string[] = [];

    for (const app of APPS) {
      const rootLayout = join(localeRootOf(app), "layout.tsx");
      const owners = filesNamed(app, CHROME_OWNER_FILE_NAMES).filter((file) => file !== rootLayout);
      for (const owner of owners) {
        const source = readSource(owner);
        for (const ingredient of INGREDIENTS) {
          if (source.includes(`"${ingredient}"`) || source.includes(`'${ingredient}'`)) {
            violations.push(
              `${repoPath(owner)} imports ${ingredient} — the shells compose chrome; pass slots instead`,
            );
          }
        }
        // An exempt layout is exempt precisely BECAUSE it arranges its own
        // chrome; re-flagging it here would contradict the exemption.
        if (SHELL_EXEMPT_LAYOUTS.includes(repoPath(owner))) continue;
        violations.push(...chromeMountedBy(owner, app));
      }
    }

    expect(violations).toEqual([]);
  });

  it("D — pay carries no Auth0 SDK, directly or through a package subpath", () => {
    const payFiles = walk(join(REPO_ROOT, "apps", "pay"), (name) =>
      SCANNABLE_EXTENSIONS.some((extension) => name.endsWith(extension)),
    );
    const tainted = auth0TaintedSpecifiers();

    const hits = payFiles.flatMap((file) => {
      const source = readSource(file);
      if (source.includes("@auth0")) {
        return [`${repoPath(file)} references @auth0 — D4: apps/pay must not gain the SDK`];
      }
      // The direct grep above is blind to the realistic path: importing
      // @mutav/app-shell/convex-auth-provider pulls the SDK into pay's bundle
      // without the string "@auth0" appearing anywhere in apps/pay.
      return tainted
        .filter((specifier) => source.includes(specifier))
        .map(
          (specifier) =>
            `${repoPath(file)} imports ${specifier}, which reaches @auth0 — D4: apps/pay must not gain the SDK`,
        );
    });

    // @mutav/app-shell's ./convex-auth-provider subpath peer-depends on
    // @auth0/nextjs-auth0. pay is clean today by import discipline, not by
    // dependency graph, so the shells must never reach for that package.
    const shellDir = join(REPO_ROOT, "packages", "ui", "src", "shell");
    const shellFiles = walk(shellDir, (name) => name.endsWith(".tsx") || name.endsWith(".ts"));
    const appShellHits = shellFiles
      .filter((file) => readSource(file).includes("@mutav/app-shell"))
      .map((file) => `${repoPath(file)} imports @mutav/app-shell — shells take identity as a prop`);

    expect([...hits, ...appShellHits], `tainted subpaths: ${tainted.join(", ") || "none"}`).toEqual(
      [],
    );
  });

  it("E — each exemption still points at a layout that really arranges its own chrome", () => {
    const violations: string[] = [];

    for (const [path, entry] of EXEMPT_LAYOUTS) {
      const absolute = join(REPO_ROOT, path);
      // A stale exemption is a silently-disabled assertion. If the fund
      // follow-up lands and the path changes, this fails and forces a decision.
      if (!isFile(absolute)) {
        violations.push(
          `${path}: exempt layout no longer exists — delete the entry (${entry.tracking})`,
        );
        continue;
      }
      // The exemption exists because the layout arranges its own chrome — Test
      // C is what it buys relief from. A layout Test C would not have flagged
      // is not an exception to the shell rule, it is a route group missing its
      // shell, and exempting it would hide every leaf beneath it from Test A by
      // appending one line to a data file.
      const app = path.split("/")[1] ?? "";
      if (chromeMountedBy(absolute, app).length === 0) {
        violations.push(
          `${path}: exempt from the shell rule but mounts no chrome of its own (inline or one hop away) — an exemption is for a layout that arranges its own chrome, not for a route group that has none`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
