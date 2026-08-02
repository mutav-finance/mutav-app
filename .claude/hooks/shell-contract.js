#!/usr/bin/env node
// PreToolUse hook — the three-shell contract at write time.
// Advisory for shell SELECTION (docs/architecture/nav-shell-audit.md § 4 / D1);
// blocking only for the two 404 paths CI rejects on sight.
//
// Deliberately separate from code-quality.js: that hook scans the diff fragment
// (`tool_input.new_string`), which for a three-line edit to an already-correct
// layout.tsx contains no import statement at all — a shell rule hosted there
// would report "no shell" on nearly every edit to a correct file. Shell rules
// need the whole file from disk plus the sibling segment tree. Their escape
// valve is also different: a tracked allowlist (tests/shell-exempt-layouts.json)
// that CI reads too, not a per-line `// hook-ok:` the merge gate never sees.
//
// Merge gate: tests/shell-contract.test.ts (`bun run test:structure`).

const { readFileSync, statSync } = require('node:fs');
const { join, dirname, basename } = require('node:path');

const ROUTE_FILE =
  /\/apps\/[^/]+\/src\/app\/(?:.*\/)?(layout|template|default|page|not-found|global-not-found)\.tsx$/;

// Verbatim from tests/shell-contract.test.ts — the hook and the merge gate must
// not disagree about what counts as a shell import.
const SHELL_IMPORT_SOURCE = String.raw`from\s+["']@mutav/ui/shell/(app-shell|flow-shell|bare-shell)["']`;
const CHROME_TAG_PATTERN = /<(header|nav|aside|footer)[\s/>]/;

const WRAPPER_FILE_NAMES = ['layout.tsx', 'template.tsx'];
const CHROME_OWNER_FILE_NAMES = ['layout.tsx', 'template.tsx', 'default.tsx'];
const LEAF_FILE_NAMES = ['page.tsx', 'default.tsx'];
const MODULE_SUFFIXES = ['.tsx', '.ts', '/index.tsx', '/index.ts'];

const SHELL_MENU = [
  '    AppShell  (@mutav/ui/shell/app-shell)  — behind a nav a signed-in user lives in',
  '    FlowShell (@mutav/ui/shell/flow-shell) — a multi-step flow: brand, no nav',
  '    BareShell (@mutav/ui/shell/bare-shell) — a terminal state: brand + a way out',
].join('\n');

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function shellsIn(source) {
  return [...source.matchAll(new RegExp(SHELL_IMPORT_SOURCE, 'g'))].map(match => match[1]);
}

function locate(filePath) {
  const match = filePath.match(/^(.*)\/apps\/([^/]+)\/src\/app\/(.+)$/);
  if (match === null) return null;
  return { repoRoot: match[1], app: match[2], rest: match[3] };
}

function exemptLayouts(repoRoot) {
  // Fail open: a missing or malformed allowlist must not turn every exempt
  // layout into an advisory. CI reads the same file and is strict about it —
  // there the schema (a `reason` + `tracking` per path) is enforced.
  try {
    const parsed = JSON.parse(read(join(repoRoot, 'tests', 'shell-exempt-layouts.json')));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
    return Object.keys(parsed);
  } catch {
    return [];
  }
}

/**
 * Wrappers enclosing `fromDir`, innermost first, EXCLUDING `[locale]/layout.tsx`
 * and `self`. The root layout owns <html>/<body>/fonts/NextIntlClientProvider in
 * every app and will never import a shell — mirrors `shellChainOf` in
 * tests/shell-contract.test.ts, which excludes it for the same reason.
 */
function ancestorWrappers(fromDir, localeRoot, self) {
  const rootLayout = join(localeRoot, 'layout.tsx');
  const found = [];
  let current = fromDir;
  while (current.startsWith(localeRoot)) {
    for (const name of WRAPPER_FILE_NAMES) {
      const candidate = join(current, name);
      if (candidate === rootLayout || candidate === self) continue;
      if (isFile(candidate)) found.push(candidate);
    }
    if (current === localeRoot) break;
    current = dirname(current);
  }
  return found;
}

function localImportBindings(source) {
  const bindings = [];
  // `[^;'"]` keeps a clause from swallowing the previous statement's specifier
  // and stealing its names — the locality filter happens after the match, not
  // inside it, so a non-local import still consumes its own line.
  const pattern = /import\s+(?:type\s+)?([^;'"]+?)\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const clause = match[1];
    const specifier = match[2];
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
    const named = clause.match(/\{([\s\S]*?)\}/);
    if (named !== null) {
      for (const part of named[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? '';
        if (name !== '') bindings.push({ name, specifier });
      }
    }
    const fallback = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(fallback)) bindings.push({ name: fallback, specifier });
  }
  return bindings;
}

function resolveLocalImport(specifier, filePath, repoRoot, app) {
  const base = specifier.startsWith('@/')
    ? join(repoRoot, 'apps', app, 'src', specifier.slice(2))
    : join(dirname(filePath), specifier);
  for (const suffix of MODULE_SUFFIXES) {
    if (isFile(`${base}${suffix}`)) return `${base}${suffix}`;
  }
  return null;
}

/**
 * Whether `tag` is rendered as a CHILD rather than handed to a prop. That
 * distinction is the whole contract: `<AppShell nav={<AgencyNav />}>` gives the
 * shell a nav, while rendering `<AgencyNav />` beside `{children}` mounts a
 * second navigation the shell knows nothing about. The merge gate parses for
 * this; here a preceding `={` is the tell, which is what prop position looks
 * like in every wrapper in the repo.
 */
function rendersAsChild(source, tag) {
  const pattern = new RegExp(`(=\\s*\\{\\s*)?<${tag}[\\s/>]`, 'g');
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1] === undefined) return true;
  }
  return false;
}

function blockingViolation(app, rest, fileName) {
  if (rest === 'not-found.tsx') {
    return (
      '[shell-contract] In THIS repo the app dir has no layout.tsx — the root layout is\n' +
      '[locale]/layout.tsx — so Next has no root layout to wrap a root src/app/not-found.tsx\n' +
      'in and supplies a builtin <html><body>: no lang, no font variable, no theme class,\n' +
      'and BareShell collapses inside it. (Repo-specific; an app with a static root layout\n' +
      'would not see this.)\n' +
      `Unmatched URLs belong in apps/${app}/src/app/global-not-found.tsx (behind\n` +
      'experimental.globalNotFound); notFound() belongs in [locale]/not-found.tsx.\n' +
      'See docs/architecture/nav-shell-audit.md § 4 (D5) and § 5.\n'
    );
  }
  if (fileName === 'not-found.tsx' && rest !== '[locale]/not-found.tsx') {
    return (
      "[shell-contract] A not-found.tsx anywhere but [locale]/ renders inside whatever\n" +
      'shell encloses it — it would keep the nav the failed route can no longer reflect,\n' +
      'and outside [locale]/ it also renders without the locale the intl provider needs.\n' +
      `Move it to apps/${app}/src/app/[locale]/not-found.tsx.\n` +
      'See docs/architecture/nav-shell-audit.md § 4 (D5).\n'
    );
  }
  if (fileName === 'global-not-found.tsx' && rest !== 'global-not-found.tsx') {
    return (
      '[shell-contract] global-not-found.tsx is an app-dir-root convention. Next never\n' +
      'reads a copy one segment down, so this file would be an inert module that satisfies\n' +
      `every import-based check and serves no 404. Move it to apps/${app}/src/app/global-not-found.tsx.\n` +
      'See docs/architecture/nav-shell-audit.md § 5.\n'
    );
  }
  return null;
}

function findAdvisories({ filePath, source, repoRoot, app, rest, fileName, repoRelative }) {
  const localeRoot = join(repoRoot, 'apps', app, 'src', 'app', '[locale]');
  const exempt = exemptLayouts(repoRoot);
  const findings = [];

  if (fileName === 'global-not-found.tsx') {
    // It is neither a wrapper nor a leaf, so the generic missing-shell branch
    // below never sees it — without this, a global 404 with no shell at all
    // draws zero shell findings from the hook.
    const shells = shellsIn(source);
    if (shells.length !== 1 || shells[0] !== 'bare-shell') {
      findings.push(
        `${repoRelative} must import exactly @mutav/ui/shell/bare-shell (found: ` +
          `${shells.join(', ') || 'none'}) — a 404 is a terminal state (D5).`
      );
    }
    const config = read(join(repoRoot, 'apps', app, 'next.config.ts'));
    if (!/globalNotFound:\s*true/.test(config)) {
      findings.push(
        `${repoRelative} is ignored until apps/${app}/next.config.ts sets\n` +
          '    experimental: { globalNotFound: true } — next-app-loader deletes the\n' +
          '    convention when the flag is off, so the file is a silent no-op.'
      );
    }
    if (!source.includes('<html') || !source.includes('<body')) {
      findings.push(
        `${repoRelative} replaces the root layout for /_not-found, so it must return\n` +
          '    a full document — <html> and <body> with the same classes as\n' +
          `    apps/${app}/src/app/[locale]/layout.tsx.`
      );
    }
  }

  if (exempt.includes(repoRelative) || rest === '[locale]/layout.tsx') {
    return findings;
  }

  const ancestors = ancestorWrappers(dirname(filePath), localeRoot, filePath);
  const exemptAncestor = ancestors.some(wrapper =>
    exempt.includes(wrapper.slice(repoRoot.length + 1))
  );
  const inherited = exemptAncestor ? [] : ancestors.flatMap(wrapper => shellsIn(read(wrapper)));
  const own = shellsIn(source);
  const resolved = [...own, ...inherited];

  if (!exemptAncestor && resolved.length === 0) {
    if (WRAPPER_FILE_NAMES.includes(fileName)) {
      findings.push(
        `${repoRelative} is a route wrapper with no shell import, and no ancestor\n` +
          '    wrapper supplies one — every rendered route resolves to exactly one shell.\n' +
          SHELL_MENU
      );
    } else if (LEAF_FILE_NAMES.includes(fileName)) {
      findings.push(
        `${repoRelative} has no shell above it and imports none itself — every\n` +
          '    rendered route resolves to exactly one shell. Mount it in the route-group\n' +
          '    layout.tsx (a page owns its shell only when no ancestor has one).\n' +
          SHELL_MENU
      );
    }
  }

  if (resolved.length > 1) {
    findings.push(
      `${repoRelative} resolves to ${resolved.length} shells (${resolved.join(' + ')}) —\n` +
        '    a nested shell double-mounts the chrome. Keep one, in the outermost wrapper.'
    );
  }

  if (CHROME_OWNER_FILE_NAMES.includes(fileName)) {
    for (const binding of localImportBindings(source)) {
      if (!rendersAsChild(source, binding.name)) continue;
      const target = resolveLocalImport(binding.specifier, filePath, repoRoot, app);
      if (target === null) continue;
      if (!CHROME_TAG_PATTERN.test(read(target))) continue;
      findings.push(
        `${repoRelative} renders <${binding.name} /> as a child and\n` +
          `    ${target.slice(repoRoot.length + 1)} hand-rolls a landmark\n` +
          '    (<header>/<nav>/<aside>/<footer>). Extracting chrome next door does not\n' +
          '    launder it — pass it to a shell slot (nav, identity, sidebarHeader,\n' +
          '    headerEnd, footer, context) instead.'
      );
      break; // one finding per rule — surface, don't spam
    }
  }

  return findings;
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    if (!['Edit', 'Write', 'MultiEdit'].includes(data.tool_name)) {
      process.exit(0);
    }
    const filePath = data.tool_input?.file_path || '';
    // First thing, before any disk I/O: ~99% of edits are not route files, and
    // this early exit is what makes a third node spawn per edit affordable.
    if (!ROUTE_FILE.test(filePath)) process.exit(0);

    const where = locate(filePath);
    if (where === null) process.exit(0);
    const { repoRoot, app, rest } = where;
    const fileName = basename(filePath);
    const repoRelative = filePath.slice(repoRoot.length + 1);

    const blocked = blockingViolation(app, rest, fileName);
    if (blocked !== null) {
      process.stderr.write(blocked);
      process.exit(2);
    }

    // Write carries the whole future file; Edit/MultiEdit carry a fragment, so
    // the file on disk is the only complete view of what is being changed.
    const source = data.tool_name === 'Write' ? data.tool_input?.content || '' : read(filePath);
    if (source === '') process.exit(0);

    const findings = findAdvisories({
      filePath,
      source,
      repoRoot,
      app,
      rest,
      fileName,
      repoRelative,
    });
    if (findings.length === 0) process.exit(0);

    const context =
      `⚠️ shell-contract: this edit hits ${findings.length} rule${findings.length > 1 ? 's' : ''} in ` +
      `docs/architecture/nav-shell-audit.md\n§ 4 (D1) / CLAUDE.md "Which shell a new route gets":\n` +
      findings.map(finding => `  • ${finding}`).join('\n') +
      '\nIf this route genuinely arranges its own chrome, it needs an entry in\n' +
      'tests/shell-exempt-layouts.json — keyed by the repo-relative layout path, with a\n' +
      '"reason" and a "tracking" reference, both of which CI validates. Not a silenced hook:\n' +
      '`// hook-ok:` does not apply here; bun run test:structure is the merge gate.';

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: context,
        },
      })
    );
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
