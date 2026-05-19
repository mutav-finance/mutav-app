# Key Management — A Practical Guide

> This guide is for engineers who have never managed cryptographic keys before. It's the hands-on companion to [`architecture/security.md`](architecture/security.md): the architecture doc is the "what" — the threat model, the asset inventory, the rotation matrix. This doc is the "how" — what you actually do, in what order, with which commands. Read this first if you're new; read the architecture doc when you need to know why a control exists.

If you only have time for one section: the [Minimum bar for Mutav today](#the-minimum-bar-for-mutav-today). Five steps, do them in order, you're defensible.

## Where we are right now

Mutav is **pre-customer**. We deliberately operate at the lowest tier of the storage maturity ladder — env-derived keys via `convex env set` and `.env.local` — because there's no real PII in any deployment yet and the additional ceremony of a managed secret store would slow iteration with no marginal risk reduction.

**This is the deliberate posture, not a gap.** Don't reach for AWS Secrets Manager or Vault today. The level-up happens as part of pre-launch hardening, alongside the rest of the [LGPD compliance milestone](https://github.com/mutav-finance/mutav-app/issues/82): finish the PII migration (P2/P3), wire the audit log (P1/P5), implement erasure (P6), then move keys to a managed store. Until then, treat the rules in this guide as discipline that costs nothing to follow now and avoids a painful cultural retrofit later.

What "dev-only" means in practice:

- Keys live in `.env.local` (local) and `convex env set` (preview / staging deployments). No managed secret store yet.
- All PII in any deployment today is fictional seed data. There is no real customer data to protect, so the "encryption-at-rest" controls are dress rehearsal — important to land _before_ customers, not an emergency to fix _after_.
- Shared keys (preview deployments, etc.) go through a shared password manager vault — not Slack DMs, not commit-and-revert. The discipline of never typing a real key into a chat window starts on day one.

If you find yourself wondering "should I set this up properly now?" the answer is: **only if doing it now is faster than doing it later**. For everything except the day-to-day hygiene rules (no keys in git, no keys in chat, one key per env), defer the heavy infrastructure to pre-launch.

## The mental model

A cryptographic key is a random number — but a really big one. 32 bytes is 256 bits, which represents more possible values than there are atoms in the observable universe. Two things follow from that:

1. **Nobody can guess it.** If you generate one with good entropy, the only way an attacker gets it is if you give it to them — by leaking it, storing it somewhere they can read, or being careless.
2. **You can't recover it from anywhere else.** Unlike a password you can reset by clicking "forgot password", a cryptographic key has no recovery path. If you lose `PII_ENCRYPTION_KEY` and you have encrypted data, that data is gone. Permanently. There's no support team that can reconstruct it for you.

The entire job of key management boils down to two questions:

- **Who or what can read this key?** (Access)
- **What happens if it's lost, leaked, or needs to change?** (Lifecycle)

Everything else is mechanics.

## Day 1 — generating your first key

The first time you encounter this in Mutav is `bunx convex env set PII_ENCRYPTION_KEY <base64>`. Here's what happens at each step.

### Generate it

```bash
openssl rand -base64 32
```

This asks your OS for 32 bytes of cryptographic randomness and base64-encodes them. The OS's random source (`/dev/urandom` on Linux/macOS) is fed by hardware entropy — keyboard timings, network jitter, thermal noise on the CPU. It's good enough.

**Don't**:

- Use online generators ("type your key here and we'll make a secure version!") — you just sent the key to the operator of that site.
- Derive it from a password ("my-secret-password-123!" hashed isn't a key, it's an enumerable input).
- Reuse a key from another project.

### Put it somewhere your app can read it

Right now in Mutav, that "somewhere" is:

- **For Convex backend code** — `bunx convex env set PII_ENCRYPTION_KEY <the-base64-thing>`. Convex stores it as an env var in their backend; your `process.env.PII_ENCRYPTION_KEY` reads it at runtime via the lazy getter in [`convex/lib/env.ts`](../convex/lib/env.ts).
- **For local dev** — `.env.local` in the project root. Same key name, same value. Your local Convex dev server reads from there.

That's it. There's no "key file" sitting on disk that you have to `chmod` or protect at the filesystem layer. The key lives inside Convex's env-var store (for prod) or in `.env.local` (for dev).

### Don't put it anywhere else

This is the part people get wrong most often. The key must not appear in:

- **Git.** Ever. `.env.local` is in `.gitignore` for this reason. If you ever see a real key in a commit — including in a removed line that's still in history — **rotate it immediately**. Assume it's compromised even if the repo is private. GitHub's secret scanners + every clone of the repo + every CI cache makes "I'll delete the commit" impossible.
- **Slack, Discord, email, AI chat logs.** All of these are searchable and persistent. Sending a key in DM is the same as posting it publicly, just with a delay before it ends up in a breach corpus somewhere.
- **Screenshots, screen shares, recorded videos.** Cover your terminal before you screen-share. Yes, this has bitten real teams.
- **README.md or any docs.** Even with placeholder text saying "replace this," the placeholder gets copy-pasted as-is enough times that it ends up in real prod somewhere. Use `<base64-32-bytes-here>` style markers, never a value that looks real.

If you ever paste a key into something for "just a second," treat it as leaked. Generate a new one and rotate.

## Day 2 — your teammate needs the key

This is the real test of whether you have a system. There are three answers, each progressively better.

### Bad — "I'll DM it to you"

What just happened: now there's a copy of the key in Slack's database, your sent-messages, their received-messages, every device backup Slack syncs, and a future export from a possible Slack breach. You no longer know where the key lives.

### OK — a shared password manager

1Password, Bitwarden, or similar. You and your teammate both have access to a shared vault. You put `PII_ENCRYPTION_KEY` in there with a note about which environment it belongs to. Onboarding a new engineer = adding them to the vault, not DMing them a key.

**This is the realistic dev/preview setup for a small team.** It's where Mutav should be before its first real customer.

### Best — a managed secret store with IAM

This is the "Level 2" maturity from [`architecture/security.md`](architecture/security.md#storage--the-maturity-ladder). Something like AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, or 1Password Connect — where:

- The key never leaves the secret store as a value people read with their eyes. Programmatic access requires being assigned an identity.
- Your Convex deployment has its own identity that can read the key at boot.
- Your CI has its own identity that can read the key for deploys.
- A human retrieving the key (break-glass during an incident) is logged and alerted.

You're not at this stage yet. You'll get here before launch. For now, a shared password manager is fine.

## Day 30 — rotation

After some time, you want to rotate the key. Maybe an engineer who had access leaves; maybe it's been a while; maybe you suspect something. For Mutav this splits into two very different cases.

### Easy — `PII_ENCRYPTION_KEY`

This key encrypts; it doesn't index. To rotate:

1. Generate `PII_ENCRYPTION_KEY_V2` with `openssl rand -base64 32`.
2. Set both keys in the env (you'll have v1 and v2 live for a moment).
3. Run a migration that reads every encrypted column, decrypts with v1, re-encrypts with v2, writes back.
4. Once the migration is done, delete v1.

The schema stays the same. Users don't notice. This is what "non-destructive rotation" means.

The PR that introduced the PII primitives doesn't ship this machinery yet — it'd need versioned envelopes (a `keyVersion` field on `EncryptedEnvelope`) and a migration helper. That's a future PR; the architecture doc has it planned.

### Painful — `PII_HMAC_KEY`

This key is the input to every `*Hash` column you've ever stored. Rotating it invalidates every hash → invalidates every index → breaks every lookup that uses one.

You **don't** routinely rotate this. You rotate it only on confirmed compromise, you treat the rotation as an incident, and you accept that the lookup paths will be broken for the duration of a full re-hash migration.

The takeaway: when you design a new key, ask yourself "what does rotation look like?" _before_ you ship the key. Some keys are cheap to rotate; some are expensive. Knowing which is which tells you how to handle them.

The full rotation matrix per key is in [`architecture/security.md`](architecture/security.md#rotation).

## What if something goes wrong

This is the part people skip. Plan it before you need it.

### "I think I leaked a key"

- **Step 1** — assume you did. The cost of treating a near-miss as a real leak is one rotation cycle. The cost of treating a real leak as a near-miss is potentially everything.
- **Step 2** — rotate immediately. For `PII_ENCRYPTION_KEY`, do the migration. For `PII_HMAC_KEY`, accept the downtime.
- **Step 3** — figure out how it leaked, and add a control so it can't leak the same way again:
  - CI logs the env? Mask it.
  - Engineer's laptop had it? Move to secret store with IAM.
  - Pasted in chat? Set up the `.env.example` pattern so the real key never gets typed by humans.

### "I lost a key"

- **Encrypted data** — the encrypted columns under that key are gone. You need a backup of the key, restored from wherever you store backups. This is why managed secret stores exist — they keep their own backups, integrated with your cloud provider's disaster-recovery story.
- **HMAC pepper** — you can rebuild it from plaintext if you still have decrypt access. Painful migration, but recoverable.
- **Treasury secret seed** — this is a Stellar account. If you lose the seed and there are funds on the account, those funds are stuck. This is why custody patterns matter: the multi-sig accounts Mutav uses for treasury operations (per [`architecture/onchain-integration.md`](architecture/onchain-integration.md)) survive single-key loss because they require N-of-M signatures.

The pattern: **the encryption key has no recovery beyond what you explicitly built**. Either you have a backup of the key itself (in a managed secret store, or sealed in a safe deposit box for the truly paranoid), or you have a procedure to regenerate the protected data from a different source.

## The minimum bar for Mutav today

If you're starting from "I've never managed keys" and you want a defensible setup _right now_, do these five things in order:

1. **Set up a shared password manager vault for the team.** 1Password or Bitwarden, paid tier so you get vault sharing. Put `PII_ENCRYPTION_KEY` and `PII_HMAC_KEY` in there, separately, with notes about which environment each belongs to.
2. **One key set per environment.** Don't reuse prod keys in preview or dev. The vault has a "Production" folder and a "Preview" folder; they look identical but the values differ.
3. **`.env.example` in the repo** with placeholder values. The README points new engineers at the vault for real values.
4. **Document who has access to the vault** in a runbook. Two people minimum; not just one engineer, because if that engineer gets hit by a bus nobody can decrypt the data.
5. **Rotate at known triggers** — engineer leaves, suspected leak, completed security audit. Quarterly is fine for routine rotation of `PII_ENCRYPTION_KEY`; only on incident for `PII_HMAC_KEY`.

That's it. Five steps. You don't need an HSM, you don't need Vault, you don't need to learn AWS IAM today. You need a vault, a discipline of not pasting keys into chat, and a runbook.

When you onboard your first real customer, level up to a managed secret store (AWS Secrets Manager or 1Password Connect — the latter is significantly easier to operate). That's the natural next step, and the architecture doc has the migration path.

## The mindset

The way to internalize this: **treat every secret as a hot potato**. The moment it touches your hand, you want to put it down somewhere safe and not be touching it anymore. The vault, the secret store, the env var — these are all "places to put the potato so it isn't in your hand." The mistakes happen when the potato sits in your hand for "just a second" (in a chat message, in a screenshot, in a debugger session).

If you find yourself thinking "I'll just paste this real quick and clean it up after" — stop. Generate a new one, paste the new one, and rotate the old one. That's faster than the cleanup you were about to skip.

## Mutav-specific cheat sheet

The exact commands for the keys this codebase uses today.

### Generate a 32-byte base64 key

```bash
openssl rand -base64 32
```

### Set in Convex (prod / preview)

```bash
bunx convex env set PII_ENCRYPTION_KEY <base64>
bunx convex env set PII_HMAC_KEY <base64>
```

For preview deployments target the right deployment with `--deployment-name`. For prod, run inside the prod project context.

### Set in `.env.local` (dev)

```bash
# .env.local
PII_ENCRYPTION_KEY=<base64>
PII_HMAC_KEY=<base64>
```

Both keys are required before any onboarding flow runs — the lazy getter in [`convex/lib/env.ts`](../convex/lib/env.ts) throws with instructions if either is missing.

### Verify a key by length

A correct 32-byte base64 string is 44 characters long (32 → 44 with `=` padding):

```bash
echo -n "<your-key>" | base64 -d | wc -c
# → 32
```

### Other Mutav keys you'll encounter

Documented in [`architecture/security.md`](architecture/security.md#asset-inventory):

| Key                                   | Used for                                    | Runtime |
| ------------------------------------- | ------------------------------------------- | ------- |
| `PII_ENCRYPTION_KEY`                  | PII encryption (AES-256-GCM)                | V8      |
| `PII_HMAC_KEY`                        | PII equality lookups (HMAC-SHA256 pepper)   | V8      |
| `MUTAV_STELLAR_SECRET_ENCRYPTION_KEY` | Per-agency Stellar proxy seed encryption    | Node    |
| `MUTAV_TREASURY_SECRET`               | Stellar treasury source account seed        | Node    |
| `ETHERFUSE_API_KEY`                   | Etherfuse REST authentication               | Node    |
| `ETHERFUSE_WEBHOOK_SECRET`            | Etherfuse inbound webhook HMAC verification | Node    |
| `RESEND_API_KEY`                      | Outbound transactional email                | Node    |

## See also

- [`architecture/security.md`](architecture/security.md) — the full security architecture: threat model, asset inventory, rotation matrix, anti-patterns
- [`architecture/decisions/0001-pii-crypto-pattern.md`](architecture/decisions/0001-pii-crypto-pattern.md) — why the two-key envelope + hash sidecar pattern
- [`architecture/regulatory.md`](architecture/regulatory.md) — LGPD constraints driving the encryption-at-rest requirement
- [`../convex/lib/pii.ts`](../convex/lib/pii.ts) — the V8 primitives (`encryptPii` / `decryptPii` / `hashPii`)
- [`../convex/lib/env.ts`](../convex/lib/env.ts) — the only file in the codebase allowed to read `process.env`
