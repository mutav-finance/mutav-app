# Security Architecture — Secrets, Keys, and PII Crypto

> What we protect, how we protect it, and how the keys are managed across environments. This document covers **asset-level security**: encryption of personal data, encryption of operational secrets (Stellar seeds, anchor webhook signing keys), and the management lifecycle of every key the system depends on. Identity / authorization is a separate concern documented in [`../auth.md`](../auth.md); access logging is in [`reliability.md`](reliability.md) § Audit log integrity. Both reference this document for the underlying primitives.
>
> Architecture decisions are anchored in [`decisions/0001-pii-crypto-pattern.md`](decisions/0001-pii-crypto-pattern.md) (two-key envelope + hash sidecar) and the LGPD floor in [`regulatory.md`](regulatory.md).
>
> **New to key management?** Start with [`../key-management-guide.md`](../key-management-guide.md) for the hands-on workflow (generate, store, share, rotate, recover). This document is the architecture reference; the guide is the practitioner's manual.
>
> **Current operating posture: pre-customer, dev-only.** Mutav runs at Level 1 of the storage maturity ladder (env-derived keys) on purpose — there's no real customer PII in any deployment yet, so the additional ceremony of a managed secret store doesn't reduce risk today. The level-up to Level 2 is scheduled alongside pre-launch hardening, not before. The controls and disciplines in this doc are designed so the cultural retrofit at launch is zero — same code paths, same key names, only the storage layer changes.

## Threat model

Three concrete failure modes drive every architectural choice. We design for each independently — a security control that only mitigates the one we already worry about offers no defense-in-depth.

| Failure                      | What the attacker has                          | What's at risk without the controls below                                                                                                                                             |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DB leak alone**            | Convex backup, table dump, exfiltrated indexes | Plaintext PII, identifiable rows. Mitigation: every PII field is encrypted at rest; hashes are HMAC-peppered so a CPF dump isn't usable.                                              |
| **Single-key leak alone**    | One env var, one IAM role over-scoped          | Either decrypt-everything or build-lookup-tables, not both. Mitigation: PII keys are split (encryption ≠ HMAC); secrets are scoped tight.                                             |
| **DB + one key (combined)**  | Backup AND one of the two PII keys             | One half of the breach — decrypt rows OR enumerate hashes, never both at once. Mitigation: the two-key design ensures this stays bounded.                                             |
| **DB + both keys**           | The whole stack                                | Total compromise. Not in scope to "mitigate"; in scope to detect quickly via audit log + alerting and rotate immediately.                                                             |
| **App-layer code execution** | Production access via vulnerability            | Attacker can call `decryptPii` directly. Out of scope for the crypto layer; mitigated by auth wrappers ([`../auth.md`](../auth.md)) and the PII access audit log (LGPD milestone P5). |

The model is deliberately conservative on `(DB + one key)`. It assumes mistakes happen — an env var pasted in a CI log, an IAM policy that grants too much, a debugger left attached — and refuses to let any single mistake be catastrophic.

## Asset inventory

Every secret the system depends on, plus where it lives, who consumes it, and what runtime it runs in. The runtime matters: V8 secrets can be read in queries and mutations; Node secrets only in `"use node"` actions.

| Asset                                 | Purpose                                                                   | Runtime | Source                                                                             | Consumed by                                                                |
| ------------------------------------- | ------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `PII_ENCRYPTION_KEY`                  | AES-256-GCM envelope for PII fields (CPF, CNPJ, email, name, phone, etc.) | V8      | [`convex/lib/env.ts`](../../convex/lib/env.ts) → `getPiiEncryptionKey()`           | [`convex/lib/pii.ts`](../../convex/lib/pii.ts) → `encryptPii`/`decryptPii` |
| `PII_HMAC_KEY`                        | HMAC-SHA256 pepper for PII equality lookups (`*Hash` sidecars)            | V8      | [`convex/lib/env.ts`](../../convex/lib/env.ts) → `getPiiHmacKey()`                 | [`convex/lib/pii.ts`](../../convex/lib/pii.ts) → `hashPii`                 |
| `MUTAV_STELLAR_SECRET_ENCRYPTION_KEY` | AES-256-GCM envelope for per-agency Stellar proxy account seeds           | Node    | [`convex/lib/env.ts`](../../convex/lib/env.ts) → `getStellarSecretEncryptionKey()` | [`convex/lib/secrets.ts`](../../convex/lib/secrets.ts) — `"use node"` only |
| `MUTAV_TREASURY_SECRET`               | Stellar treasury source-account secret seed (`S…`)                        | Node    | [`convex/lib/env.ts`](../../convex/lib/env.ts) → `getTreasurySecret()`             | Anchor SEP-10 signing actions                                              |
| `ETHERFUSE_API_KEY`                   | Authenticates REST calls to Etherfuse on-ramp / customer endpoints        | Node    | [`convex/lib/env.ts`](../../convex/lib/env.ts) → `getEtherfuseApiKey()`            | Etherfuse anchor actions                                                   |
| `ETHERFUSE_WEBHOOK_SECRET`            | HMAC-SHA256 verification of inbound Etherfuse webhooks                    | Node    | [`convex/lib/env.ts`](../../convex/lib/env.ts) → `getEtherfuseWebhookSecret()`     | `convex/http.ts` webhook handler                                           |
| `RESEND_API_KEY`                      | Outbound transactional email                                              | Node    | [`convex/lib/env.ts`](../../convex/lib/env.ts) → `getResendApiKey()`               | Notification actions                                                       |

Boundary rule: only `convex/lib/env.ts` reads `process.env`. Every other module obtains secrets through a lazy getter. The boundary is enforced by the regression-greps script (see [`scripts/regression-greps.sh`](../../scripts/regression-greps.sh) § "process.env outside env boundary").

## The PII crypto pattern

Every PII field is stored as two columns:

```typescript
defineTable({
  // ...
  cpfHash: v.string(), // hashPii(cpf) — indexed for lookups
  cpfEncrypted: encryptedEnvelopeValidator, // {ciphertext, iv, authTag} all base64
});
```

- `cpfHash` = `HMAC-SHA256(plaintext, PII_HMAC_KEY)`, hex-encoded, 64 chars. Indexed when equality lookup is needed (`by_cpfHash`). Computed via `hashPii(value)` from [`convex/lib/pii.ts`](../../convex/lib/pii.ts).
- `cpfEncrypted` = AES-256-GCM envelope: `{ciphertext, iv, authTag}` (all base64). The IV is freshly generated per call (`crypto.getRandomValues(new Uint8Array(12))`); the auth tag is the GCM integrity check that detects ciphertext tampering on decrypt.

When a table needs only equality lookup (e.g., `claimedDocuments` — does this document belong to any agency?), the `*Encrypted` column is dropped entirely. The hash _is_ the value:

```typescript
claimedDocuments: defineTable({
  documentHash: v.string(),     // hashPii(cpf | cnpj) — no plaintext anywhere
  agencyId: v.id("agencies"),
  claimedAt: v.string(),
}).index("by_documentHash", ["documentHash"]),
```

**Why two keys, not one.** A single key collapses the threat model — compromise of that one key gives the attacker everything (decrypt rows AND build lookup tables). With two keys, each compromise scenario is bounded. The cost is two env vars and a slightly more complex rotation story; the benefit is that no single mistake is catastrophic. Full rationale in [`decisions/0001-pii-crypto-pattern.md`](decisions/0001-pii-crypto-pattern.md).

**Why hash, not encrypt-then-search.** Convex indexes match exact string equality. To preserve indexed lookup on encrypted fields, the equality key must be a deterministic function of the plaintext. A plain SHA-256 of an 11-digit CPF is rainbow-table enumerable in seconds; HMAC under a server-side pepper closes that. The pepper is the entire point.

**Why AES-256-GCM.** Confidentiality + integrity in one primitive. Tampering with ciphertext or auth tag fails the verification on decrypt — the attacker cannot mutate a stored envelope without detection. The 96-bit IV keeps GCM's uniqueness invariant intact at any throughput Mutav will plausibly reach.

## Runtime split: V8 vs Node

The Convex backend has two runtimes; the crypto layer respects that split intentionally.

| Module                                                 | Runtime             | Why                                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`convex/lib/pii.ts`](../../convex/lib/pii.ts)         | V8 (WebCrypto)      | PII reads and writes happen inside queries and mutations everywhere — agency profile, contract creation, payment receipts, admin review. Forcing them through an action boundary would double request latency. |
| [`convex/lib/secrets.ts`](../../convex/lib/secrets.ts) | Node (`"use node"`) | The only consumer is the Stellar treasury / proxy seed encryption path. Seeds are only decrypted inside SEP-10 signing actions, which are Node-resident anyway. Node's `node:crypto` is the natural fit.       |

The two modules export the same `{ciphertext, iv, authTag}` envelope shape so the on-disk contract is identical — a future migration could collapse them into one V8 implementation that handles both, but that's not justified today. The Stellar seeds and the PII data have different threat models and different rotation cadences; keeping them apart keeps blast radius localized.

WebCrypto note: V8 in Convex implements the standard `globalThis.crypto.subtle` API. AES-GCM with a `BufferSource` returns ciphertext + auth tag concatenated; [`pii.ts`](../../convex/lib/pii.ts) splits the trailing 16 bytes back out so the envelope shape matches the Node side. Tests exercise the encrypt-decrypt roundtrip, tamper detection on both `ciphertext` and `authTag`, HMAC determinism, and that different keys produce different hashes ([`convex/lib/pii.test.ts`](../../convex/lib/pii.test.ts)).

## The first consumer: `claimedDocuments` race fix

Phase 0 of the LGPD compliance milestone ([#82](https://github.com/mutav-finance/mutav-app/issues/82), [#88](https://github.com/mutav-finance/mutav-app/issues/88)) introduced the table `claimedDocuments({documentHash, agencyId, claimedAt})` as the first concrete consumer of the hash sidecar pattern. It simultaneously demonstrates the mechanism _and_ closes a real race in `submitOnboarding`:

```
Before P0 (pre-claim):
  Tx A reads agencies by_cpf  → no other SUBMITTED row
  Tx B reads agencies by_cpf  → no other SUBMITTED row
  Tx A patches agencyA to SUBMITTED  ✓
  Tx B patches agencyB to SUBMITTED  ✓
  ← TWO agencies hold the same CPF in SUBMITTED. Manual review catches it eventually,
    but the race is real and the schema invariant has already been broken.

After P0 (with claim row):
  Tx A reads claimedDocuments by_documentHash  → empty
  Tx B reads claimedDocuments by_documentHash  → empty
  Tx A inserts claim row + patches agencyA  ✓ commits first
  Tx B inserts claim row + patches agencyB  → OCC conflict (read set changed)
  Tx B auto-retries:
    reads claimedDocuments by_documentHash → finds A's row
    returns ALREADY_REGISTERED
  ← One agency holds the CPF. The second agency's mutation never reaches the patch.
```

The lifecycle is minimal: insert on submit, delete on `reviewOnboarding(rejected)`, retain on `reviewOnboarding(approved)`. Erasure (LGPD P6, [#97](https://github.com/mutav-finance/mutav-app/issues/97)) extends this — `eraseUser` will also delete the claim rows of erased agencies, keeping a tombstone with a hashed-anonymized actor ref for CVM record-keeping.

## Key management lifecycle

Mutav is currently on **env-derived keys**, which is appropriate for dev/preview but not for production. The production target is a managed secret store with automated rotation and IAM-bound access. This section is the playbook for getting there.

### Generation

- **One key per purpose, never reused.** `PII_ENCRYPTION_KEY` ≠ `PII_HMAC_KEY` ≠ `MUTAV_STELLAR_SECRET_ENCRYPTION_KEY` ≠ `ETHERFUSE_WEBHOOK_SECRET`. The defense-in-depth argument from two-key separation collapses the moment any one is reused.
- **One key set per environment.** Prod, staging, preview, dev each get distinct keys. Never copy prod keys down to a lower environment "just to test" — a prod-key leak through a developer laptop is one of the most common breach paths.
- **Real entropy.** `openssl rand -base64 32` is acceptable; a KMS-generated key is better because it never existed in userspace. Never derive PII keys from passwords or application secrets.
- **32 bytes minimum** for both AES-256 and HMAC-SHA256. The env getter validates length and throws on mismatch.

### Storage — the maturity ladder

Mutav climbs this as it scales. v1 ships at level 1; the production target before first real-customer onboarding is level 2.

| Level | Storage                                                            | Trust boundary                                                           | Mutav status                                           |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1     | `.env.local` / `convex env set …`                                  | Whoever has access to the env var (dev laptops, Convex dashboard).       | **Current** — pre-customer dev/preview only.           |
| 2     | Managed secret store (Secrets Manager / Vault / 1Password Connect) | App reads via authenticated API; secret never lives in env vars at rest. | **Production target.**                                 |
| 3     | KMS-wrapped envelope encryption                                    | Data key generated per-request, root key never leaves the HSM.           | Justified if a high-tier investor PII surface emerges. |
| 4     | HSM-native operations (CloudHSM / Nitro Enclaves / YubiHSM)        | Plaintext key never touches application memory.                          | Overkill until regulator scrutiny demands it.          |

For Mutav's scale and threat model, **(2) is the realistic production target.** AWS Secrets Manager or 1Password Connect both check the box: IAM-bound retrieval, automatic rotation hooks, CloudTrail-equivalent audit. Move to (3) only if a future investor tier holds PII attractive enough to warrant per-request data-key generation.

### Access control

- **Least privilege at the secret layer.** A function that only hashes shouldn't be able to read `PII_ENCRYPTION_KEY`. Today both keys are read from the same scope (`process.env`), which is acceptable while the keys live in env vars; at level 2 the secret store grants the read-side separately from the write-side identity.
- **Identity-bound, not env-bound.** The secret store grants access to a workload identity (Convex deployment role, CI workload identity), not "anyone with the env var." When the swap happens, IAM policies replace env-var inheritance as the access-control surface.
- **Break-glass is logged and alerted.** Engineers can retrieve keys during incidents, but every retrieval emits an alert. False positives are acceptable; silent retrieval is not.
- **The env getter is the only allowed `process.env` reader.** Enforced by the regression-greps script. New env vars are added there or not at all.

### Rotation

The two key classes have very different rotation cost. Build for both.

| Key                                   | Routine cadence                     | Migration cost                                                                                                                                                                  | Trigger for ad-hoc rotation                 |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `PII_ENCRYPTION_KEY`                  | Quarterly (suggested)               | **Non-destructive.** Re-encrypt migration: read each envelope under `KEY_OLD`, decrypt, re-encrypt under `KEY_NEW`, write back. Schema unchanged.                               | Suspected compromise, role offboarding.     |
| `PII_HMAC_KEY`                        | Only on confirmed compromise        | **Destructive.** Invalidates every `*Hash` column and every index built on one. Requires a re-hash migration plus index rebuilds; the lookup path is broken until it completes. | Confirmed compromise — incident response.   |
| `MUTAV_STELLAR_SECRET_ENCRYPTION_KEY` | Yearly                              | Non-destructive, same pattern as PII encryption key.                                                                                                                            | Compromise; departing engineer who held it. |
| `MUTAV_TREASURY_SECRET`               | Whenever a custody handover happens | **Operational, not cryptographic.** Move funds to a new source account and update the env var; the old account's history stays on chain.                                        | Compromise; custody policy change.          |
| `ETHERFUSE_WEBHOOK_SECRET`            | At the anchor's cadence             | Provider-side rotation; trigger a webhook re-registration via [`scripts/etherfuse-register-webhook.ts`](../../scripts/etherfuse-register-webhook.ts) and update env.            | Anchor instructs.                           |

**Versioned envelopes.** Before shipping rotation, add a `keyVersion: number` field inside the envelope (default `1` for the current write path). Decryption looks up the right key by version; writes always use the current one. Old envelopes coexist with new during the rolling migration window instead of forcing a stop-the-world cutover. The schema change is additive — the validator gets a new optional field.

**Document a rotation runbook before you need one.** Include: who has approval authority, communication template, expected migration duration, rollback plan if the new key is itself compromised mid-rotation.

### Audit + alerting

- **Every key access is logged at the secret-store layer.** Once on level 2, CloudTrail (or Vault audit log, or equivalent) emits an event per retrieval. No application instrumentation needed.
- **Anomaly alerts.** Unexpected IP, off-hours retrieval, retrieval volume spike. False positives are fine; silent retrieval is not.
- **Cross-reference with the PII access log.** LGPD milestone P5 ([#96](https://github.com/mutav-finance/mutav-app/issues/96)) introduces `mutavAuditLog` entries on every `decryptPii` call with a `purpose` tag (DSR export / admin profile view / checkout receipt / etc.). When a decrypt looks suspicious, you can correlate "who pulled the key at 14:30" with "whose PII was decrypted at 14:32" using the two logs together. Audit log integrity in [`reliability.md`](reliability.md) § Audit log integrity.

### Recovery and backup

- **Lost `PII_ENCRYPTION_KEY` = lost PII.** Encrypted columns become unrecoverable. The secret store must have its own backup story; KMS handles this automatically, Vault needs explicit snapshot policy.
- **Lost `PII_HMAC_KEY` = lost lookups, not lost data.** The plaintext is still recoverable via the encryption key, and the hash sidecar can be rebuilt from plaintext + a freshly generated HMAC key. Painful, recoverable.
- **Test the restore path in dev.** A backup never restored from is a wish, not a backup.

## Cross-jurisdictional concerns

The three-entity model in [`entities.md`](entities.md) introduces a security dimension the single-entity model didn't have: keys-per-entity. Each entity has its own regulatory posture (`Mutav-BR` under LGPD; `Mutav-Fund` / `Mutav-Mgmt` under their offshore domicile) and its own PII surface (BR investors + agencies vs. offshore-domiciled investor records).

| Concern                                   | Architectural implication                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Key residency vs. data residency**      | LGPD permits cross-border data transfer with SCCs (see [`regulatory.md`](regulatory.md) § LGPD). It does not force key residency. Hosting the secret store in a Brazilian region simplifies the audit story but isn't a hard requirement.                                                                                                     |
| **Per-entity PII key sets**               | When the three-entity model lands, each entity should hold its own PII key pair. A `Mutav-BR` compromise must not reach `Mutav-Fund` investor data — the BR agency tenant rows and the offshore investor profile rows decrypt under independent keys. Deferred to the entity refactor (see [`entities.md`](entities.md) for tracking issues). |
| **KYC vendor's keys are not your keys**   | Sumsub / Idwall / future KYC vendors hold their own PII under their own keys. Mutav's encryption-at-rest covers only what Convex stores. The DPO conversation must distinguish the two; the data processor agreement is a separate document.                                                                                                  |
| **BCB 519/2025 reporting flows offshore** | Cessão reporting (BR → offshore) carries metadata, not encrypted PII payloads. The reporting integration consumes hashes for correlation; plaintext stays in `Mutav-BR`. See [`regulatory.md`](regulatory.md) § BCB câmbio reporting.                                                                                                         |

## Anti-patterns the codebase rejects

The regression-greps script (`scripts/regression-greps.sh`) enforces some of these in CI; others are review-time discipline.

- **Hardcoded keys** for any reason, including "just for a test." Tests use deterministic fill bytes (`Buffer.alloc(32, 0xaa).toString('base64')`) so the test plaintext is reproducible without the test key ever being a real one.
- **Keys in git** — even private repo, even temporarily. The `.env.example` template uses placeholder values; the real keys are pulled from the secret store / Convex env via a documented procedure.
- **Keys in PR descriptions, commit messages, Slack threads, or AI chat logs.** All of these get indexed, cached, exfiltrated through unrelated breaches. Treat them as public.
- **`process.env` outside `convex/lib/env.ts` or `src/lib/env.ts`.** Regression-greps enforces this. New env vars are added there or not at all.
- **Calling `getPiiEncryptionKey()` or `getPiiHmacKey()` outside `convex/lib/pii.ts`.** The primitive is the only allowed consumer; everything else uses `encryptPii` / `decryptPii` / `hashPii`. Direct key access from a domain module is a code-review block.
- **Logging plaintext PII.** This is application-layer, not key-layer, but it defeats the encryption: the cleartext ends up in a log aggregator the encryption was supposed to protect against. PII access logging (LGPD P5) logs the _fact_ of access, never the value.
- **Storing a decrypted value back to the database.** A decrypt is always for presentation/export. Re-encrypting under the same key with a new IV is fine; persisting the plaintext breaks the invariant.

## Current state and target

| Control                      | Current (v1, pre-customer)                                                                                                                                                                | Target (production)                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PII encryption at rest**   | Primitive ready ([`pii.ts`](../../convex/lib/pii.ts)); first consumer (`claimedDocuments`) live. Existing PII columns (CPF, CNPJ, email, etc.) still plaintext — migration in LGPD P2/P3. | Every PII field uses `*Hash + *Encrypted`; zero raw `v.string()` PII columns in [`convex/schema.ts`](../../convex/schema.ts).                                                                  |
| **Key storage**              | Env-derived via `convex env set` + `.env.local`.                                                                                                                                          | Managed secret store (AWS Secrets Manager / 1Password Connect), IAM-bound retrieval.                                                                                                           |
| **Key rotation**             | Manual. No versioned envelopes yet.                                                                                                                                                       | Quarterly automated rotation on `PII_ENCRYPTION_KEY`; versioned envelopes for rolling migrations.                                                                                              |
| **Audit logging on decrypt** | Not implemented.                                                                                                                                                                          | LGPD P5 ([#96](https://github.com/mutav-finance/mutav-app/issues/96)) — every decrypt emits a `mutavAuditLog` row with a `purpose` tag.                                                        |
| **Erasure workflow**         | Not implemented.                                                                                                                                                                          | LGPD P6 ([#97](https://github.com/mutav-finance/mutav-app/issues/97)) — `eraseUser` cascades across domains, leaves a CVM-compliant tombstone.                                                 |
| **DSR surfaces**             | Not implemented.                                                                                                                                                                          | LGPD P7 ([#98](https://github.com/mutav-finance/mutav-app/issues/98)) — export endpoint (signed link), inbound erasure request, DPO contact.                                                   |
| **Audit log integrity**      | Not implemented.                                                                                                                                                                          | LGPD P1 ([#79](https://github.com/mutav-finance/mutav-app/issues/79)) — hash-chained `mutavAuditLog`, daily Merkle anchor to chain ([`reliability.md`](reliability.md) § Audit log integrity). |
| **Per-entity key isolation** | Single key set for all of Mutav.                                                                                                                                                          | Separate key pairs per entity (`Mutav-BR`, `Mutav-Fund`, `Mutav-Mgmt`).                                                                                                                        |

LGPD-driven phases are tracked in [#82](https://github.com/mutav-finance/mutav-app/issues/82). The first row of the target column lands incrementally — P2/P3 migrate the existing PII surface; P5/P6/P7 round out the LGPD compliance posture.

## References

- [`decisions/0001-pii-crypto-pattern.md`](decisions/0001-pii-crypto-pattern.md) — Two-key envelope + hash sidecar rationale
- [`regulatory.md`](regulatory.md) — LGPD architectural constraints, cross-border data transfer
- [`reliability.md`](reliability.md) — Audit log integrity, workflow durability (used by erasure)
- [`compliance.md`](compliance.md) — Capability matrix consulted on PII-touching mutations
- [`../auth.md`](../auth.md) — Identity / authorization (the separate concern this doc deliberately excludes)
- [`../../convex/lib/pii.ts`](../../convex/lib/pii.ts) — V8 primitives
- [`../../convex/lib/secrets.ts`](../../convex/lib/secrets.ts) — Node-only envelope for Stellar seeds
- [`../../convex/lib/env.ts`](../../convex/lib/env.ts) — The only `process.env` boundary
- [`../../scripts/regression-greps.sh`](../../scripts/regression-greps.sh) — Lint-time anti-pattern enforcement
- LGPD compliance master tracking: [#82](https://github.com/mutav-finance/mutav-app/issues/82)
