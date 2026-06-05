#!/usr/bin/env node
// PreToolUse hook — advisory. Surfaces type-escape and barrel-file patterns to the agent
// without blocking the tool call. Real gate is a pre-commit skill (TODO).
//
// Rules (mirrored in mutav-app/CLAUDE.md "TypeScript Rules" + "Code Style"):
//   1. `: any` annotations
//   2. `as <Type>` casts
//   3. `!` non-null assertions
//   4. `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`
//   5. raw `process.env.*` outside env modules
//   6. barrel `index.ts(x)` files in feature code
//
// Escape valve: lines containing `// hook-ok: <reason>` are skipped.

const RULES = [
  {
    name: ': any type',
    re: /:\s*any\b|<\s*any[\s,>]|Array<any>|Promise<any>|Record<[^>]+,\s*any>/,
    fix: '`unknown` + Zod validation, generics, or a discriminated union',
  },
  {
    name: '`as <Type>` cast',
    re: /\bas\s+[A-Z][A-Za-z0-9_]+\b/,
    skipImports: true,
    fix: 'type guard, `?.` / `??`, validate at boundary, or fix the upstream type',
  },
  {
    name: '`!` non-null assertion',
    re: /[A-Za-z0-9_\])]!\s*[.([]/,
    fix: '`?.`, explicit null check, or refine via type guard',
  },
  {
    name: '`@ts-*` suppression',
    re: /@ts-(ignore|expect-error|nocheck)\b/,
    fix: 'refactor to satisfy the type checker; document a true exception with `// hook-ok: <reason>`',
  },
  {
    name: 'raw `process.env.*` outside env modules',
    re: /process\.env\.[A-Z_]+/,
    fix: 'import from `src/lib/env.ts` or `convex/lib/env.ts`',
  },
];

const ENV_MODULES = ['src/lib/env.ts', 'convex/lib/env.ts'];
const EXCLUDED_PATHS = [
  '/node_modules/',
  '/.next/',
  '/dist/',
  '/build/',
  '/convex/_generated/',
  '/__tests__/',
  '/.test.',
  '/scripts/',
];

function shouldScan(filePath) {
  if (!/\.tsx?$/.test(filePath)) return false;
  if (ENV_MODULES.some(m => filePath.endsWith(m))) return false;
  if (EXCLUDED_PATHS.some(p => filePath.includes(p))) return false;
  return true;
}

function isFeatureCodePath(filePath) {
  // Barrel ban applies under src/, apps/*/src/, convex/ — but NOT packages/*/index.ts (public surface).
  if (filePath.includes('/packages/') && /\/packages\/[^/]+\/index\.tsx?$/.test(filePath)) {
    return false;
  }
  return /\/(src|convex|apps\/[^/]+\/src)\//.test(filePath) || /\/apps\/[^/]+\//.test(filePath);
}

function findRuleHits(content) {
  const hits = [];
  const lines = content.split('\n');
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('// hook-ok:')) continue;
      if (rule.skipImports && /^\s*(import|export)\b/.test(line)) continue;
      if (rule.re.test(line)) {
        hits.push({ rule: rule.name, fix: rule.fix, line: i + 1, sample: line.trim().slice(0, 100) });
        break; // one hit per rule is enough — surface, don't spam
      }
    }
  }
  return hits;
}

function isBarrel(filePath, content) {
  if (!/\/index\.tsx?$/.test(filePath)) return false;
  if (!isFeatureCodePath(filePath)) return false;
  return /^\s*export\s+\{|^\s*export\s+\*/m.test(content);
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
    if (!shouldScan(filePath)) process.exit(0);

    const content = data.tool_input?.content || data.tool_input?.new_string || '';
    if (!content) process.exit(0);

    const hits = findRuleHits(content);
    if (data.tool_name === 'Write' && isBarrel(filePath, content)) {
      hits.push({
        rule: 'barrel `index.ts(x)` in feature code',
        fix: "import the actual file path, e.g. `import { Foo } from './Foo'`",
        line: 1,
        sample: '(new index file)',
      });
    }
    if (hits.length === 0) process.exit(0);

    const lines = hits.map(
      h => `  • ${h.rule} (line ${h.line}): \`${h.sample}\` — use ${h.fix}`
    );
    const context =
      `⚠️ code-quality: this edit hits ${hits.length} rule${hits.length > 1 ? 's' : ''} in ` +
      `mutav-app/CLAUDE.md "TypeScript Rules" / "Code Style":\n` +
      lines.join('\n') +
      `\nIf this is a documented boundary exception (route param, external API response, Convex ` +
      `deserialization), add \`// hook-ok: <reason>\` on the line.`;

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
