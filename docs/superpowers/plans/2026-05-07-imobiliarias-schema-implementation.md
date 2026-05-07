# Imobiliárias schema implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Imobiliárias prototype schema — `agencies`, modified `contracts` + `contractHistory`, and new `payments` table — and migrate `*BRL: v.number()` fields to integer-cents (`*Cents: v.number()`).

**Architecture:** One schema change set. New domain folder layout (`convex/{agencies,contracts,payments}/{domain.ts,useCases.ts}`) per the migration trigger in CLAUDE.md. The seed and existing UI consumers update in the same change to track the renamed fields and new API namespace.

**Tech Stack:** Convex 1.35 (schema, validators, codegen), Next.js 16 App Router, TypeScript strict, Bun. No test infra in place — verification is via codegen + typecheck + dev server render.

**Spec:** `docs/superpowers/specs/2026-05-07-imobiliarias-prototype-schema-design.md` (PR #15, merged as `3fa1d3d`)

**Issue:** #16

---

### Task 1: Setup — branch + plan committed

**Files:**

- Modify: `.gitignore`
- Create: `docs/superpowers/plans/2026-05-07-imobiliarias-schema-implementation.md` (this file)

- [ ] **Step 1: Confirm branch is `feat/imobiliarias-schema`**

```bash
git rev-parse --abbrev-ref HEAD
```

Expected: `feat/imobiliarias-schema`

- [ ] **Step 2: Confirm `.gitignore` un-ignores `docs/superpowers/plans/`**

The block should read:

```
# Superpowers session state — not for the repo. Specs and plans are tracked.
.superpowers/
docs/superpowers/*
!docs/superpowers/specs/
!docs/superpowers/plans/
```

- [ ] **Step 3: Commit setup**

```bash
git add .gitignore docs/superpowers/plans/
git commit -m "chore: track docs/superpowers/plans/ + add schema implementation plan"
```

---

### Task 2: Schema — new tables + cents migration

**Files:**

- Modify: `convex/schema.ts`

- [ ] **Step 1: Replace `convex/schema.ts` with the new shape**

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const contractStatus = v.union(
  v.literal("ativo"),
  v.literal("encerrado"),
  v.literal("pendente"),
  v.literal("cancelado"),
);

const documentStatus = v.union(
  v.literal("pendente"),
  v.literal("enviado"),
  v.literal("aprovado"),
);

const documentKey = v.union(
  v.literal("rentalContract"),
  v.literal("inspection"),
  v.literal("policy"),
);

const propertyKind = v.union(v.literal("residencial"), v.literal("comercial"));

const tenantApprovalStatus = v.union(
  v.literal("aprovado"),
  v.literal("pendente"),
  v.literal("reprovado"),
);

const paymentStatus = v.union(
  v.literal("pending"),
  v.literal("paid"),
  v.literal("overdue"),
  v.literal("canceled"),
);

const paymentLineItemKind = v.union(v.literal("recurring"), v.literal("activation"));

export default defineSchema({
  agencies: defineTable({
    name: v.string(),
    cnpj: v.string(),
    createdAt: v.string(),
  }).index("by_cnpj", ["cnpj"]),

  contracts: defineTable({
    agencyId: v.id("agencies"),
    publicId: v.string(),
    status: contractStatus,
    nextRenewalDate: v.string(),
    availableGuaranteeCents: v.number(),

    rental: v.object({
      propertyKind,
      rentCents: v.number(),
      condoCents: v.number(),
      otherFeesCents: v.number(),
      totalRentCents: v.number(),
      feeCents: v.number(),
      oneTimeActivationFeeCents: v.number(),
      setupInstallments: v.number(),
      exitCostMultiplier: v.string(),
      rentMultiplier: v.string(),
      payer: v.string(),
      pviMigrationSchedule: v.union(v.string(), v.null()),
    }),

    property: v.object({
      cep: v.string(),
      streetAndNumber: v.string(),
      neighborhood: v.string(),
      cityUF: v.string(),
    }),

    optional: v.object({
      complement: v.string(),
      tag: v.string(),
      description: v.string(),
    }),

    documents: v.array(
      v.object({
        key: documentKey,
        status: documentStatus,
      }),
    ),

    tenant: v.object({
      approvalStatus: tenantApprovalStatus,
      fullName: v.string(),
      cpf: v.string(),
      birthDate: v.string(),
      email: v.string(),
      phone: v.string(),
      termApprovedAt: v.union(v.string(), v.null()),
    }),
  })
    .index("by_publicId", ["publicId"])
    .index("by_status", ["status"])
    .index("by_agency_status", ["agencyId", "status"]),

  contractHistory: defineTable({
    agencyId: v.id("agencies"),
    contractPublicId: v.string(),
    at: v.string(),
    username: v.string(),
    message: v.string(),
  }).index("by_contract", ["contractPublicId", "at"]),

  payments: defineTable({
    agencyId: v.id("agencies"),
    publicId: v.string(),
    periodMonth: v.string(),
    issuedAt: v.string(),
    dueDate: v.string(),
    totalCents: v.number(),
    status: paymentStatus,
    lineItems: v.array(
      v.object({
        contractId: v.id("contracts"),
        contractPublicId: v.string(),
        kind: paymentLineItemKind,
        amountCents: v.number(),
        description: v.string(),
      }),
    ),
    barcode: v.union(v.string(), v.null()),
    paidAt: v.union(v.string(), v.null()),
  })
    .index("by_agency_period", ["agencyId", "periodMonth"])
    .index("by_status", ["status"])
    .index("by_publicId", ["publicId"]),
});
```

- [ ] **Step 2: Regenerate Convex types**

```bash
bunx convex codegen
```

Expected: completes; `convex/_generated/dataModel.d.ts` reflects all four tables.

- [ ] **Step 3: Run typecheck — expect downstream errors**

```bash
bun run typecheck
```

Expected: errors in `convex/contracts.ts`, `convex/seed.ts`, `src/lib/contracts/types.ts`, `src/components/contracts/contract-rental-data-card.tsx`, `src/components/contracts/contract-summary-card.tsx`. **Do not fix yet** — they're addressed in Tasks 4–9.

- [ ] **Step 4: Commit schema**

```bash
git add convex/schema.ts convex/_generated/
git commit -m "feat(schema): add agencies + payments, multi-tenant contracts in cents"
```

---

### Task 3: Agencies domain module

**Files:**

- Create: `convex/agencies/domain.ts`
- Create: `convex/agencies/useCases.ts`

- [ ] **Step 1: Create `convex/agencies/domain.ts`**

```typescript
import type { Doc, Id } from "../_generated/dataModel";

export type Agency = Doc<"agencies">;
export type AgencyId = Id<"agencies">;
```

- [ ] **Step 2: Create `convex/agencies/useCases.ts`**

```typescript
import { v } from "convex/values";
import { query } from "../_generated/server";

export const listAgencies = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("agencies").collect();
  },
});

export const getAgency = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.agencyId);
  },
});
```

- [ ] **Step 3: Codegen**

```bash
bunx convex codegen
```

Expected: completes; `api.agencies.useCases.{listAgencies,getAgency}` available.

- [ ] **Step 4: Commit**

```bash
git add convex/agencies/
git commit -m "feat(agencies): domain module + queries"
```

---

### Task 4: Contracts — promote flat file to domain folder

**Files:**

- Delete: `convex/contracts.ts`
- Create: `convex/contracts/domain.ts`
- Create: `convex/contracts/useCases.ts`

- [ ] **Step 1: Create `convex/contracts/domain.ts`**

```typescript
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type Contract = Doc<"contracts">;
export type ContractId = Id<"contracts">;
export type ContractStatus = Contract["status"];
export type PropertyKind = Contract["rental"]["propertyKind"];
export type DocumentKey = Contract["documents"][number]["key"];
export type DocumentStatus = Contract["documents"][number]["status"];
export type TenantApprovalStatus = Contract["tenant"]["approvalStatus"];

export const CONTRACT_STATUS = {
  ATIVO: "ativo",
  ENCERRADO: "encerrado",
  PENDENTE: "pendente",
  CANCELADO: "cancelado",
} as const satisfies Record<Uppercase<ContractStatus>, ContractStatus>;

export const PROPERTY_KIND = {
  RESIDENCIAL: "residencial",
  COMERCIAL: "comercial",
} as const satisfies Record<Uppercase<PropertyKind>, PropertyKind>;

export const contractStatusValidator = v.union(
  v.literal(CONTRACT_STATUS.ATIVO),
  v.literal(CONTRACT_STATUS.ENCERRADO),
  v.literal(CONTRACT_STATUS.PENDENTE),
  v.literal(CONTRACT_STATUS.CANCELADO),
);
```

- [ ] **Step 2: Create `convex/contracts/useCases.ts` (move from `convex/contracts.ts` + update for cents and `agencyId`)**

```typescript
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * Public read of one contract by its human-facing public id.
 *
 * SECURITY POSTURE (MVP):
 * No identity check today (`auth.config.ts` has empty providers). Replace
 * the body with `await requireIdentity(ctx)` + an agency-scoped ownership
 * check before going to production.
 */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    if (!contract) {
      return null;
    }

    const history = await ctx.db
      .query("contractHistory")
      .withIndex("by_contract", (q) => q.eq("contractPublicId", args.publicId))
      .order("desc")
      .take(100);

    return shapeContract(contract, history);
  },
});

/** Public paginated list — same security caveat as `getByPublicId`. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("contracts").order("desc").paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((doc) => ({
        id: doc.publicId,
        agencyId: doc.agencyId,
        status: doc.status,
        nextRenewalDate: doc.nextRenewalDate,
        availableGuaranteeCents: doc.availableGuaranteeCents,
        tenantName: doc.tenant.fullName,
      })),
    };
  },
});

/** Paginated list scoped to one agency. */
export const listByAgency = query({
  args: {
    agencyId: v.id("agencies"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("contracts")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", args.agencyId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((doc) => ({
        id: doc.publicId,
        status: doc.status,
        nextRenewalDate: doc.nextRenewalDate,
        availableGuaranteeCents: doc.availableGuaranteeCents,
        tenantName: doc.tenant.fullName,
      })),
    };
  },
});

/**
 * Reshape a Convex `contracts` doc + history into the UI Contract type.
 * Strips system fields (`_id`, `_creationTime`); renames publicId → id.
 */
function shapeContract(doc: Doc<"contracts">, history: Doc<"contractHistory">[]) {
  return {
    id: doc.publicId,
    agencyId: doc.agencyId,
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    availableGuaranteeCents: doc.availableGuaranteeCents,
    rental: doc.rental,
    property: doc.property,
    optional: doc.optional,
    documents: doc.documents,
    tenant: doc.tenant,
    history: history.map((h) => ({
      at: h.at,
      username: h.username,
      message: h.message,
    })),
  };
}
```

- [ ] **Step 3: Delete the old flat file**

```bash
git rm convex/contracts.ts
```

- [ ] **Step 4: Codegen — API namespace changes from `api.contracts.*` to `api.contracts.useCases.*`**

```bash
bunx convex codegen
```

Expected: completes. Consumers now fail typecheck — fixed in Task 9.

- [ ] **Step 5: Commit**

```bash
git add convex/contracts/ convex/contracts.ts
git commit -m "feat(contracts): promote to domain folder + cents fields + listByAgency"
```

---

### Task 5: Payments domain module

**Files:**

- Create: `convex/payments/domain.ts`
- Create: `convex/payments/useCases.ts`

- [ ] **Step 1: Create `convex/payments/domain.ts`**

```typescript
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type Payment = Doc<"payments">;
export type PaymentId = Id<"payments">;
export type PaymentStatus = Payment["status"];
export type PaymentLineItem = Payment["lineItems"][number];
export type PaymentLineItemKind = PaymentLineItem["kind"];

export const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  OVERDUE: "overdue",
  CANCELED: "canceled",
} as const satisfies Record<Uppercase<PaymentStatus>, PaymentStatus>;

export const PAYMENT_LINE_ITEM_KIND = {
  RECURRING: "recurring",
  ACTIVATION: "activation",
} as const satisfies Record<Uppercase<PaymentLineItemKind>, PaymentLineItemKind>;

export const paymentStatusValidator = v.union(
  v.literal(PAYMENT_STATUS.PENDING),
  v.literal(PAYMENT_STATUS.PAID),
  v.literal(PAYMENT_STATUS.OVERDUE),
  v.literal(PAYMENT_STATUS.CANCELED),
);

export const paymentLineItemKindValidator = v.union(
  v.literal(PAYMENT_LINE_ITEM_KIND.RECURRING),
  v.literal(PAYMENT_LINE_ITEM_KIND.ACTIVATION),
);
```

- [ ] **Step 2: Create `convex/payments/useCases.ts`**

```typescript
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "../_generated/server";

export const listByAgency = query({
  args: {
    agencyId: v.id("agencies"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("payments")
      .withIndex("by_agency_period", (q) => q.eq("agencyId", args.agencyId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getById = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.paymentId);
  },
});

export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("payments")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
  },
});
```

- [ ] **Step 3: Codegen**

```bash
bunx convex codegen
```

Expected: completes; `api.payments.useCases.*` available.

- [ ] **Step 4: Commit**

```bash
git add convex/payments/
git commit -m "feat(payments): domain module + queries"
```

---

### Task 6: Seed rewrite

**Files:**

- Modify: `convex/seed.ts`

- [ ] **Step 1: Replace `convex/seed.ts`**

```typescript
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Idempotent dev seed — inserts two fictional imobiliárias, one contract
 * each, contract history for the first, and one payment per agency.
 * Wipes prior copies so re-runs produce a deterministic dataset.
 *
 *     bunx convex run seed:fictionalContract
 *
 * Dev-only. Do NOT call from production.
 */
export const fictionalContract = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Wipe in dependency order: payments → history → contracts → agencies.
    for (const table of ["payments", "contractHistory", "contracts", "agencies"] as const) {
      let rows = await ctx.db.query(table).take(200);
      while (rows.length > 0) {
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
        rows = await ctx.db.query(table).take(200);
      }
    }

    const agencyPaulistaId: Id<"agencies"> = await ctx.db.insert("agencies", {
      name: "Imobiliária Paulista",
      cnpj: "00000000000100",
      createdAt: "2026-01-15T00:00:00-03:00",
    });

    const agencyAtlanticaId: Id<"agencies"> = await ctx.db.insert("agencies", {
      name: "Imobiliária Atlântica",
      cnpj: "00000000000200",
      createdAt: "2026-02-01T00:00:00-03:00",
    });

    const PUBLIC_ID_1 = "1000001";
    const PUBLIC_ID_2 = "1000002";

    const contract1Id: Id<"contracts"> = await ctx.db.insert("contracts", {
      agencyId: agencyPaulistaId,
      publicId: PUBLIC_ID_1,
      status: "ativo",
      nextRenewalDate: "2027-08-15",
      availableGuaranteeCents: 9_000_000,
      rental: {
        propertyKind: "residencial",
        rentCents: 320_000,
        condoCents: 45_000,
        otherFeesCents: 0,
        totalRentCents: 365_000,
        feeCents: 512_000,
        oneTimeActivationFeeCents: 20_000,
        setupInstallments: 1,
        exitCostMultiplier: "6x",
        rentMultiplier: "40x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01310-100",
        streetAndNumber: "Av. Paulista, 1500",
        neighborhood: "Bela Vista",
        cityUF: "São Paulo/SP",
      },
      optional: {
        complement: "Apto 204",
        tag: "",
        description: "",
      },
      documents: [
        { key: "rentalContract", status: "pendente" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "aprovado",
        fullName: "Maria Silva Santos",
        cpf: "00000000000",
        birthDate: "1990-05-12",
        email: "maria.exemplo@example.com",
        phone: "11900000000",
        termApprovedAt: "2026-04-22T17:36:00-03:00",
      },
    });

    await ctx.db.insert("contracts", {
      agencyId: agencyAtlanticaId,
      publicId: PUBLIC_ID_2,
      status: "pendente",
      nextRenewalDate: "2027-12-01",
      availableGuaranteeCents: 12_000_000,
      rental: {
        propertyKind: "comercial",
        rentCents: 580_000,
        condoCents: 95_000,
        otherFeesCents: 12_000,
        totalRentCents: 687_000,
        feeCents: 928_000,
        oneTimeActivationFeeCents: 30_000,
        setupInstallments: 2,
        exitCostMultiplier: "8x",
        rentMultiplier: "30x",
        payer: "Recorrência via Imobiliária",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "22250-040",
        streetAndNumber: "Rua Visconde de Pirajá, 414",
        neighborhood: "Ipanema",
        cityUF: "Rio de Janeiro/RJ",
      },
      optional: {
        complement: "Sala 808",
        tag: "comercial-premium",
        description: "Sala comercial em prédio histórico.",
      },
      documents: [
        { key: "rentalContract", status: "enviado" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "pendente",
        fullName: "João Pereira Almeida",
        cpf: "00000000001",
        birthDate: "1985-11-30",
        email: "joao.exemplo@example.com",
        phone: "21900000000",
        termApprovedAt: null,
      },
    });

    await ctx.db.insert("contractHistory", {
      agencyId: agencyPaulistaId,
      contractPublicId: PUBLIC_ID_1,
      at: "2026-04-22T10:32:00-03:00",
      username: "usuario.exemplo",
      message:
        "Criada Solicitação #1000001 do tipo residencial, no produto Flex (Custo de saída: 6,00x; Cobertura: 40x; Comissão: 2,00%), com setup de R$ 200,00 e valor de aluguel R$ 3.200,00, valor do condomínio R$ 450,00, valor das taxas R$ 0,00, totalizando R$ 3.650,00. O imóvel está situado no endereço Av. Paulista, 1500, Bela Vista, São Paulo/SP.",
    });

    await ctx.db.insert("contractHistory", {
      agencyId: agencyPaulistaId,
      contractPublicId: PUBLIC_ID_1,
      at: "2026-04-22T17:03:00-03:00",
      username: "usuario.exemplo",
      message:
        "Atualizado status do contrato: 1000001. | Para: Aprovado. | Por usuário: usuario.exemplo",
    });

    await ctx.db.insert("payments", {
      agencyId: agencyPaulistaId,
      publicId: "PAY-2026-04-PAU",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: 532_000,
      status: "paid",
      lineItems: [
        {
          contractId: contract1Id,
          contractPublicId: PUBLIC_ID_1,
          kind: "recurring",
          amountCents: 512_000,
          description: "Mensalidade contrato 1000001",
        },
        {
          contractId: contract1Id,
          contractPublicId: PUBLIC_ID_1,
          kind: "activation",
          amountCents: 20_000,
          description: "Taxa de ativação contrato 1000001",
        },
      ],
      barcode: null,
      paidAt: "2026-04-08T14:21:00-03:00",
    });

    await ctx.db.insert("payments", {
      agencyId: agencyAtlanticaId,
      publicId: "PAY-2026-04-ATL",
      periodMonth: "2026-04",
      issuedAt: "2026-04-01",
      dueDate: "2026-04-10",
      totalCents: 0,
      status: "pending",
      lineItems: [],
      barcode: null,
      paidAt: null,
    });

    return { agencies: [agencyPaulistaId, agencyAtlanticaId], contracts: [contract1Id] };
  },
});

/** Bulk wipe — admin only. */
export const clearAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of ["payments", "contractHistory", "contracts", "agencies"] as const) {
      let rows = await ctx.db.query(table).take(200);
      while (rows.length > 0) {
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
        rows = await ctx.db.query(table).take(200);
      }
    }
    return null;
  },
});
```

- [ ] **Step 2: Codegen + Convex-side typecheck**

```bash
bunx convex codegen
bun run typecheck
```

Expected: codegen clean. Convex files (`convex/seed.ts`, `convex/agencies/`, `convex/contracts/`, `convex/payments/`) typecheck clean. Frontend errors remain — fixed in Tasks 7–9.

- [ ] **Step 3: Commit**

```bash
git add convex/seed.ts
git commit -m "feat(seed): two agencies, two contracts, two payments — cents amounts"
```

---

### Task 7: UI types + formatters in cents

**Files:**

- Modify: `src/lib/contracts/types.ts`
- Modify: `src/lib/contracts/format.ts`

- [ ] **Step 1: Replace `src/lib/contracts/types.ts`**

```typescript
export type ContractStatus = "ativo" | "encerrado" | "pendente" | "cancelado";

export type DocumentStatus = "pendente" | "enviado" | "aprovado";

export type PropertyKind = "residencial" | "comercial";

export type ContractRentalData = {
  propertyKind: PropertyKind;
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
  totalRentCents: number;
  feeCents: number;
  oneTimeActivationFeeCents: number;
  setupInstallments: number;
  exitCostMultiplier: string;
  rentMultiplier: string;
  payer: string;
  pviMigrationSchedule: string | null;
};

export type ContractProperty = {
  cep: string;
  streetAndNumber: string;
  neighborhood: string;
  cityUF: string;
};

export type ContractOptional = {
  complement: string;
  tag: string;
  description: string;
};

export type ContractDocumentKey = "rentalContract" | "inspection" | "policy";

export type ContractDocument = {
  key: ContractDocumentKey;
  status: DocumentStatus;
};

export type ContractHistoryEntry = {
  at: string;
  username: string;
  message: string;
};

export type TenantApprovalStatus = "aprovado" | "pendente" | "reprovado";

export type ContractTenant = {
  approvalStatus: TenantApprovalStatus;
  fullName: string;
  cpf: string;
  birthDate: string;
  email: string;
  phone: string;
  termApprovedAt: string | null;
};

export type Contract = {
  id: string;
  agencyId: string;
  status: ContractStatus;
  nextRenewalDate: string;
  availableGuaranteeCents: number;
  rental: ContractRentalData;
  property: ContractProperty;
  optional: ContractOptional;
  documents: ContractDocument[];
  history: ContractHistoryEntry[];
  tenant: ContractTenant;
};
```

- [ ] **Step 2: Replace `src/lib/contracts/format.ts`**

The currency formatter takes integer cents per the project's money convention.

```typescript
/** Format an integer-cents BRL value as a localized currency string. */
export function formatBRLCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

export function formatDateBR(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatDateTimeBR(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/contracts/types.ts src/lib/contracts/format.ts
git commit -m "feat(contracts/ui): cents semantics for money types and formatter"
```

---

### Task 8: Update card components

**Files:**

- Modify: `src/components/contracts/contract-rental-data-card.tsx`
- Modify: `src/components/contracts/contract-summary-card.tsx`

- [ ] **Step 1: Update import + field accesses in `contract-rental-data-card.tsx`**

Change the import:

```typescript
import { formatBRLCents } from "@/lib/contracts/format";
```

Replace each occurrence in JSX:

| Before                                                        | After                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `formatBRL(rental.rentBRL)`                                   | `formatBRLCents(rental.rentCents)`                                     |
| `formatBRL(rental.condoBRL)`                                  | `formatBRLCents(rental.condoCents)`                                    |
| `formatBRL(rental.otherFeesBRL)`                              | `formatBRLCents(rental.otherFeesCents)`                                |
| `formatBRL(rental.totalRentBRL)`                              | `formatBRLCents(rental.totalRentCents)`                                |
| `formatBRL(rental.feeBRL)`                                    | `formatBRLCents(rental.feeCents)`                                      |
| `formatBRL(rental.oneTimeActivationFeeBRL)`                   | `formatBRLCents(rental.oneTimeActivationFeeCents)`                     |

- [ ] **Step 2: Update import + field accesses in `contract-summary-card.tsx`**

Change the import:

```typescript
import { formatBRLCents, formatDateBR } from "@/lib/contracts/format";
```

Replace `formatBRL(contract.availableGuaranteeBRL)` with `formatBRLCents(contract.availableGuaranteeCents)` (and any other `formatBRL` calls in this file with the cents-named field).

- [ ] **Step 3: Verify no `formatBRL` or `*BRL` references remain in `src/`**

```bash
grep -rn 'formatBRL\b\|BRL: number\|BRL[^C]' src/ | grep -v 'BRLCents\|formatBRLCents'
```

Expected: empty (or only matches inside strings, like `"BRL"` currency literal in `format.ts` which is correct).

- [ ] **Step 4: Commit**

```bash
git add src/components/contracts/
git commit -m "feat(contracts/ui): card components use cents fields"
```

---

### Task 9: Update API consumer paths

**Files:**

- Modify: `src/app/[locale]/(app)/contracts/[id]/page.tsx`
- Modify: `src/components/contracts/contract-details-page.tsx`
- Modify: any other file `grep` finds with `api.contracts.*`

The Convex API namespace changed from `api.contracts.foo` → `api.contracts.useCases.foo`.

- [ ] **Step 1: Find all `api.contracts.*` consumers**

```bash
grep -rn 'api\.contracts\.' src/
```

Take note of each result.

- [ ] **Step 2: Replace each match**

For every `api.contracts.X(...)` call, change to `api.contracts.useCases.X(...)`.

The two known files:

- `src/app/[locale]/(app)/contracts/[id]/page.tsx`
- `src/components/contracts/contract-details-page.tsx`

If grep returned more files, update each the same way.

- [ ] **Step 3: Verify typecheck is clean**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "refactor(contracts): consumers use new api.contracts.useCases namespace"
```

---

### Task 10: Verify acceptance criteria + open PR

- [ ] **Step 1: Confirm typecheck**

```bash
bun run typecheck
```

Expected: clean exit.

- [ ] **Step 2: Run Convex dev server**

In one terminal:

```bash
bunx convex dev
```

Expected: schema validates and pushes; server stays running. If prompted to confirm a schema change, accept.

- [ ] **Step 3: Run seed and verify**

In a second terminal (with `bunx convex dev` running):

```bash
bunx convex run seed:fictionalContract
```

Expected output: `{ agencies: [...two ids...], contracts: [...one id...] }` with no errors.

Verify in the Convex dashboard (data tab):

- 2 rows in `agencies`
- 2 rows in `contracts` (publicId 1000001 + 1000002, with non-null `agencyId`)
- 2 rows in `contractHistory` (both linking to 1000001)
- 2 rows in `payments` (one per agency)

- [ ] **Step 4: Render the contract page**

Start the Next.js dev server in a third terminal:

```bash
bun run dev:web
```

Open `http://localhost:3000/contracts/1000001` (use the locale-prefixed URL if the default redirect routes you elsewhere).

Verify:

- Page renders (no 500 error, no React error overlay)
- Currency values display formatted (`R$ 3.200,00` for `rentCents: 320_000`, `R$ 90.000,00` for `availableGuaranteeCents: 9_000_000`, etc.)
- Tenant name, property address, history entries display as before
- No console errors about missing fields

- [ ] **Step 5: Push branch**

```bash
git push -u origin feat/imobiliarias-schema
```

- [ ] **Step 6: Open PR closing #16**

```bash
gh pr create --title "feat(schema): agencies, payments, contracts in cents (closes #16)" --body "$(cat <<'EOF'
Implements the schema design from #15 (`docs/superpowers/specs/2026-05-07-imobiliarias-prototype-schema-design.md`).

## Changes

- New \`agencies\` table (multi-tenancy from day one)
- \`contracts\` and \`contractHistory\` gain \`agencyId\`; \`*BRL: v.number()\` fields renamed to \`*Cents: v.number()\` (per CLAUDE.md → Domain conventions / Money)
- New \`payments\` table for per-agency monthly aggregated billing
- \`convex/contracts.ts\` promoted to \`convex/contracts/{domain.ts,useCases.ts}\`; new \`convex/agencies/\` and \`convex/payments/\` domain folders
- \`convex/seed.ts\` rewritten with two agencies, two contracts, two payments
- UI \`Contract\` types and the currency formatter migrate to cents semantics
- API consumers updated for the new \`api.contracts.useCases.*\` namespace

Closes #16.

## Test plan

- [x] \`bun run typecheck\` clean
- [x] \`bunx convex dev\` runs the new schema
- [x] \`bunx convex run seed:fictionalContract\` populates the seed
- [x] Contract details page renders with correct currency formatting at \`/contracts/1000001\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Open questions for follow-up specs (from the schema spec — not blocking)

1. **`feeCents` semantics** — is the value monthly recurring, annual, or lifetime? Resolved when we design the payment generation flow (#18).
2. **Activation fee billing trigger** — fold into the same monthly payment as activation date, or always next month? Resolved in #18.
3. **Period overlap** — if a contract terminates mid-month, pro-rate / full / skip? Resolved in #18.
