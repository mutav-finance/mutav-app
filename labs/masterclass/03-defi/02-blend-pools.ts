// Blend doesn't expose a hosted REST API. Pool data is read directly from
// the Soroban contract via the official SDK.
//
// To wire this up:
//
//   bun add @blend-capital/blend-sdk
//
// Then:
//
//   import { PoolV2 } from "@blend-capital/blend-sdk";
//   const pool = await PoolV2.load(rpc, POOL_ADDRESS);
//   for (const [assetId, reserve] of pool.reserves) {
//     console.log(assetId, reserve.config.collateralFactor, reserve.totalSupply);
//   }
//
// Per-pool addresses (testnet + mainnet) are listed in docs.blend.capital.
// For Mutav, the asset choice depends on which Blend pool indexes TESOURO
// or USDC and the borrow/supply caps fit our risk model.

console.log("Blend integration is a docs stub — see comments at the top of this file.");
console.log("Skipped until we identify the right testnet pool address for the project.");
