# .claude/commands/

Deliberately empty for now.

## Why

For repeatable dev tasks, this repo prefers **`bun` scripts in `package.json`** over slash commands. Reasons:

- One source of truth — humans (`bun run foo`), CI, and agents all invoke the same string.
- Discoverable via `package.json` scripts + [README § Scripts](../../README.md#scripts) without knowing that `/foo` exists.
- Works from any subdirectory, from any shell, from any editor.
- No cognitive tax of "which slash commands does this repo add?" for new contributors or agents entering a fresh session.

A slash command earns its place here when it does something a `bun` script _can't_ — for example, wrapping an interactive prompt (`AskUserQuestion`), composing agents, or reaching for context outside the shell (session memory, other MCP servers).

## Adding a command

If you have a use case that meets that bar, drop a `.md` file here matching the shape documented by the `command-development` skill (frontmatter + prompt body). Then update this README to list what's available and when to use it, so the empty-`.claude/commands` invariant doesn't silently break.

## What NOT to put here

- **Test invocations** — use `bun run test:convex`, `bun run test:file <path>`, etc. See [README § Testing](../../README.md#testing).
- **Seed / build / typecheck** — all live as `bun` scripts.
- **Custom "run this domain's tests"** shortcuts — trivially expressible as `bun run test:file convex/<domain>/`.
