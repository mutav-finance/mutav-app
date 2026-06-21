import { Keypair } from "@stellar/stellar-sdk";

const keypair = Keypair.random();

console.log("Public  :", keypair.publicKey());
console.log("Secret  :", keypair.secret());
console.log();
console.log("Fund on testnet:");
console.log(`  curl 'https://friendbot.stellar.org?addr=${keypair.publicKey()}'`);
console.log();
console.log("Paste the secret into labs/masterclass/.env as MASTER_SECRET (or SPONSOR_SECRET).");
