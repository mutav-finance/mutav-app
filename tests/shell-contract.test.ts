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

/**
 * `fund/(investor)` keeps its own top-bar arrangement instead of AppShell.
 * Serving both from one component needs either a boolean flag or a
 * `navPlacement` enum that would drag SidebarProvider's cookie/keyboard/CSS-var
 * machinery into a sidebar-less app. Three unsettled contradictions sit under
 * fund first (scroll ownership, the literal `dark` class instead of
 * next-themes, no ThemeProvider/Toaster/TooltipProvider) — see
 * docs/architecture/nav-shell-audit.md § 7 "Follow-ups", which gates the
 * adoption on § 6 being resolved. Remove this entry when that lands.
 */
const SHELL_EXEMPT_LAYOUTS: readonly string[] = [
  "apps/fund/src/app/[locale]/(investor)/layout.tsx",
];

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

  it("B — each app has exactly one not-found.tsx, at [locale]/, on BareShell", () => {
    const violations: string[] = [];

    for (const app of APPS) {
      if (!isDirectory(localeRootOf(app))) {
        violations.push(
          `${app}: no src/app/[locale] route root — every app under apps/ is a Next app`,
        );
        continue;
      }
      const notFounds = filesNamed(app, ["not-found.tsx"]);
      const expected = join(localeRootOf(app), "not-found.tsx");

      if (notFounds.length === 0) {
        violations.push(`${app}: no not-found.tsx (D5 — every app gets one, on BareShell)`);
        continue;
      }
      for (const found of notFounds) {
        if (found !== expected) {
          // A not-found.tsx inside a route group would import BareShell,
          // satisfy every import-based check, and still render inside that
          // group's AppShell sidebar. Only its PATH reveals the bug.
          violations.push(
            `${repoPath(found)}: nested not-found renders inside its group's shell — move it to ${repoPath(expected)}`,
          );
        }
      }
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

  it("the exempt layouts named above still exist", () => {
    // A stale exemption is a silently-disabled assertion. If the fund
    // follow-up lands and the path changes, this fails and forces a decision.
    const missing = SHELL_EXEMPT_LAYOUTS.filter((path) => !isFile(join(REPO_ROOT, path)));

    expect(missing).toEqual([]);
  });
});
