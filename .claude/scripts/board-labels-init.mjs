#!/usr/bin/env node
// Propagates the Mutav label standard (priority:* / area:* / owner:*) to every
// repo in the org. Idempotent: `gh label create --force` updates color/description
// if the label already exists. Creating labels notifies no one, but it mutates
// repos, so this is invoked only on explicit approval (never by board-sync.mjs).
//
// Usage:
//   node board-labels-init.mjs            # apply to all repos
//   node board-labels-init.mjs --dry-run  # print what would be created

import { execFileSync } from "node:child_process";

const OWNER = "mutav-finance";
const REPOS = ["mutav-app", "mutav", "mutav-pulse", "mutav-stellar", "mutav-fund", "mutav-solana", "brand"];
const DRY_RUN = process.argv.includes("--dry-run");

const LABELS = [
  { name: "priority:high", color: "b60205", description: "Do first" },
  { name: "priority:med", color: "fbca04", description: "Normal priority" },
  { name: "priority:low", color: "0e8a16", description: "Nice to have" },
  { name: "area:contracts", color: "0e8a16", description: "Soroban/Rust contracts" },
  { name: "area:frontend", color: "1d76db", description: "Next.js frontend" },
  { name: "area:docs", color: "0075ca", description: "Documentation" },
  { name: "area:business", color: "5319e7", description: "Business / strategy" },
  { name: "owner:cto", color: "006b75", description: "CTO — technical" },
  { name: "owner:ceo", color: "8b4513", description: "CEO — business" },
];

for (const repo of REPOS) {
  for (const l of LABELS) {
    if (DRY_RUN) { console.log(`[DRY-RUN] ${OWNER}/${repo}: ${l.name}`); continue; }
    execFileSync("gh", ["label", "create", l.name, "--repo", `${OWNER}/${repo}`,
      "--color", l.color, "--description", l.description, "--force"], { encoding: "utf8" });
    console.log(`${OWNER}/${repo}: ${l.name} ok`);
  }
}
console.log(`${DRY_RUN ? "[DRY-RUN] " : ""}Done — ${REPOS.length} repos x ${LABELS.length} labels`);
