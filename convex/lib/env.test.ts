// @vitest-environment edge-runtime
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  getAuth0MgmtClientId,
  getAuth0MgmtClientSecret,
  getReserveContractId,
  getReservePolicyContractId,
  getReserveRegistryContractId,
  getStellarRpcUrl,
  getReserveBrlPeggedSymbols,
  getReserveUsdSymbols,
  getBcbPtaxBaseUrl,
} from "./env";

describe("getAuth0MgmtClientId", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.AUTH0_MGMT_CLIENT_ID;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH0_MGMT_CLIENT_ID;
    else process.env.AUTH0_MGMT_CLIENT_ID = original;
  });

  test("returns the value when set", () => {
    process.env.AUTH0_MGMT_CLIENT_ID = "mgmt_client_xyz";
    expect(getAuth0MgmtClientId()).toBe("mgmt_client_xyz");
  });

  test("throws a helpful error when missing", () => {
    delete process.env.AUTH0_MGMT_CLIENT_ID;
    expect(() => getAuth0MgmtClientId()).toThrow(/AUTH0_MGMT_CLIENT_ID/);
  });
});

describe("getAuth0MgmtClientSecret", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.AUTH0_MGMT_CLIENT_SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH0_MGMT_CLIENT_SECRET;
    else process.env.AUTH0_MGMT_CLIENT_SECRET = original;
  });

  test("returns the value when set", () => {
    process.env.AUTH0_MGMT_CLIENT_SECRET = "mgmt_secret_abc";
    expect(getAuth0MgmtClientSecret()).toBe("mgmt_secret_abc");
  });

  test("throws a helpful error when missing", () => {
    delete process.env.AUTH0_MGMT_CLIENT_SECRET;
    expect(() => getAuth0MgmtClientSecret()).toThrow(/AUTH0_MGMT_CLIENT_SECRET/);
  });
});

describe("getReserveContractId", () => {
  const KEY = "STELLAR_RESERVE_CONTRACT_ID";
  const NET = "STELLAR_NETWORK";
  let origId: string | undefined;
  let origNet: string | undefined;
  beforeEach(() => {
    origId = process.env[KEY];
    origNet = process.env[NET];
  });
  afterEach(() => {
    if (origId === undefined) delete process.env[KEY];
    else process.env[KEY] = origId;
    if (origNet === undefined) delete process.env[NET];
    else process.env[NET] = origNet;
  });

  test("returns the explicit value when set", () => {
    process.env[KEY] = "CXYZ";
    expect(getReserveContractId()).toBe("CXYZ");
  });

  test("falls back to the mutav-pulse testnet vault when unset on testnet", () => {
    delete process.env[KEY];
    delete process.env[NET];
    expect(getReserveContractId()).toBe("CA26WJGO5MINAT47DCGMU54HYW5A3RQ7VSE4ANPCYYA4TGXTJZQJ5EZQ");
  });

  test("returns null on public network when unset (no mainnet default)", () => {
    delete process.env[KEY];
    process.env[NET] = "public";
    expect(getReserveContractId()).toBeNull();
  });
});

describe.each([
  {
    name: "getReservePolicyContractId",
    read: getReservePolicyContractId,
    key: "STELLAR_RESERVE_POLICY_CONTRACT_ID",
    testnetDefault: "CBC2IJHH3FQMIQETFYDIEQG7OFJXTRKKLJDDONQ6N47AB3HLWWEIZQVO",
  },
  {
    name: "getReserveRegistryContractId",
    read: getReserveRegistryContractId,
    key: "STELLAR_RESERVE_REGISTRY_CONTRACT_ID",
    testnetDefault: "CDJYJLUJL55SFD5YPSEKH6IZN3XRPLOCSFG33LDXOHEI2JY2ILITUSZ4",
  },
])("$name", ({ read, key, testnetDefault }) => {
  const NET = "STELLAR_NETWORK";
  let origId: string | undefined;
  let origNet: string | undefined;
  beforeEach(() => {
    origId = process.env[key];
    origNet = process.env[NET];
  });
  afterEach(() => {
    if (origId === undefined) delete process.env[key];
    else process.env[key] = origId;
    if (origNet === undefined) delete process.env[NET];
    else process.env[NET] = origNet;
  });

  test("returns the explicit value when set", () => {
    process.env[key] = "CXYZ";
    expect(read()).toBe("CXYZ");
  });

  test("falls back to the mutav-pulse testnet contract when unset on testnet", () => {
    delete process.env[key];
    delete process.env[NET];
    expect(read()).toBe(testnetDefault);
  });

  test("returns null on public network when unset (no mainnet default)", () => {
    delete process.env[key];
    process.env[NET] = "public";
    expect(read()).toBeNull();
  });
});

describe("getReserveBrlPeggedSymbols", () => {
  const KEY = "STELLAR_RESERVE_BRL_SYMBOLS";
  let orig: string | undefined;
  beforeEach(() => {
    orig = process.env[KEY];
  });
  afterEach(() => {
    if (orig === undefined) delete process.env[KEY];
    else process.env[KEY] = orig;
  });

  test("defaults to the BRL-pegged symbol set", () => {
    delete process.env[KEY];
    expect(getReserveBrlPeggedSymbols()).toEqual(["BRLT", "BRL", "TBRL"]);
  });

  test("parses a comma-separated override", () => {
    process.env[KEY] = "BRLX, FOO ,BAR";
    expect(getReserveBrlPeggedSymbols()).toEqual(["BRLX", "FOO", "BAR"]);
  });
});

describe("getReserveUsdSymbols", () => {
  const KEY = "STELLAR_RESERVE_USD_SYMBOLS";
  let orig: string | undefined;
  beforeEach(() => {
    orig = process.env[KEY];
  });
  afterEach(() => {
    if (orig === undefined) delete process.env[KEY];
    else process.env[KEY] = orig;
  });

  test("defaults to the USD-pegged symbol set", () => {
    delete process.env[KEY];
    expect(getReserveUsdSymbols()).toEqual(["USDC", "USDCMOCK", "cUSD"]);
  });

  test("parses a comma-separated override", () => {
    process.env[KEY] = "USDC, USDX ,FOO";
    expect(getReserveUsdSymbols()).toEqual(["USDC", "USDX", "FOO"]);
  });

  test("falls back to the default when the override parses empty", () => {
    process.env[KEY] = " , ,";
    expect(getReserveUsdSymbols()).toEqual(["USDC", "USDCMOCK", "cUSD"]);
  });
});

describe("getBcbPtaxBaseUrl", () => {
  const KEY = "BCB_PTAX_BASE_URL";
  let orig: string | undefined;
  beforeEach(() => {
    orig = process.env[KEY];
  });
  afterEach(() => {
    if (orig === undefined) delete process.env[KEY];
    else process.env[KEY] = orig;
  });

  test("defaults to the BCB PTAX olinda OData base url", () => {
    delete process.env[KEY];
    expect(getBcbPtaxBaseUrl()).toBe(
      "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata",
    );
  });

  test("respects an explicit override", () => {
    process.env[KEY] = "https://ptax.example/odata";
    expect(getBcbPtaxBaseUrl()).toBe("https://ptax.example/odata");
  });
});

describe("getStellarRpcUrl", () => {
  const URLK = "STELLAR_SOROBAN_RPC_URL";
  const NET = "STELLAR_NETWORK";
  let origUrl: string | undefined;
  let origNet: string | undefined;
  beforeEach(() => {
    origUrl = process.env[URLK];
    origNet = process.env[NET];
  });
  afterEach(() => {
    if (origUrl === undefined) delete process.env[URLK];
    else process.env[URLK] = origUrl;
    if (origNet === undefined) delete process.env[NET];
    else process.env[NET] = origNet;
  });

  test("defaults to testnet Soroban RPC", () => {
    delete process.env[URLK];
    delete process.env[NET];
    expect(getStellarRpcUrl()).toBe("https://soroban-testnet.stellar.org");
  });

  test("respects an explicit override", () => {
    process.env[URLK] = "https://my-rpc.example";
    expect(getStellarRpcUrl()).toBe("https://my-rpc.example");
  });

  test("defaults to mainnet Soroban RPC on public network", () => {
    delete process.env[URLK];
    process.env[NET] = "public";
    expect(getStellarRpcUrl()).toBe("https://mainnet.sorobanrpc.com");
  });
});
