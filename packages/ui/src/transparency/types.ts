/**
 * View shapes for the shared reserve / capacity panels. Declared here rather
 * than imported from `convex/transparency/domain.ts` because `@mutav/ui`
 * carries no backend dependency (same rule as `guarantee-state-tag`). The
 * Convex `ReserveCoverage` is structurally assignable to `ReserveCoverageView`,
 * so a drift on the server fails typecheck at every call site that passes it in.
 *
 * Every amount on `ReserveSolvencyView` is in whole units of `assetSymbol` (the
 * vault's deposit token — cUSD on testnet), never BRL.
 */

export type ContractReferenceView = { id: string; explorerUrl: string };

export type ReservePositionView = {
  kind: "idle" | "strategy";
  address: string;
  volatile: boolean;
  balance: number;
  share: number | null;
  explorerUrl: string;
};

export type ReserveSolvencyView = {
  network: "testnet" | "public";
  assetSymbol: string;
  totalAssets: number;
  stableAssets: number;
  coverageRequired: number;
  coverageRatio: number | null;
  requiredCoverageRatio: number;
  remainingCapacity: number;
  capacityCeiling: number | null;
  capacityUtilization: number | null;
  contracts: {
    vault: ContractReferenceView;
    policy: ContractReferenceView;
    registry: ContractReferenceView;
  };
  positions: ReservePositionView[];
};

export type ReserveCoverageView = { explorerUrl: string } & (
  | {
      available: true;
      storedValueCents: number;
      fxUsdBrl: number;
      fxQuotedAt: string;
      capturedAt: number;
      solvency: ReserveSolvencyView | null;
    }
  | { available: false }
);

/** `null`/`undefined` = still loading; `{ available: false }` = no usable read. */
export type ReserveCoverageInput = ReserveCoverageView | null | undefined;
