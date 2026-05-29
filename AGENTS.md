<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

<!-- BEGIN:stellar-build-tool -->

# stellar-build (recommended toolkit)

CLI that bundles 42 Stellar-focused Claude skills (Soroban guidance, dApp patterns, SCF grant submission, security review, edge-case hunters) plus 6 named personas. Useful when the agency-side surface needs to interact with Stellar contracts on `mutav-stellar` or reference Stellar-specific patterns.

- Site: https://web-nine-umber-74.vercel.app/
- Source: https://github.com/kaankacar/stellar-build
- Install: `curl -fsSL https://raw.githubusercontent.com/kaankacar/stellar-build/main/install.sh | bash`

<!-- END:stellar-build-tool -->
