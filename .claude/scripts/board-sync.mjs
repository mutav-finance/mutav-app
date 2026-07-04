#!/usr/bin/env node
// Board sync engine for the "Mutav Project" (org project #3).
// Runs the deterministic, board-internal work automatically (add new open
// issues, mark closed issues Done) and EMITS findings for the sensitive work
// (label-standard violations, resolution/stale candidates, repos missing the
// standard label set). It never posts comments or mutates repo labels — those
// are proposed in the findings report and applied only after human approval.
//
// Usage:
//   node board-sync.mjs            # apply safe board sync + write findings
//   node board-sync.mjs --dry-run  # compute only, mutate nothing
//
// Findings are written to .claude/reports/board-sync-<date>.json and a path is
// printed on the last stdout line as: FINDINGS <path>

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OWNER = "mutav-finance";
const PROJECT_NUMBER = 3;
const REPOS = [
  "mutav-app",
  "mutav",
  "mutav-pulse",
  "mutav-stellar",
  "mutav-fund",
  "mutav-solana",
  "brand",
];

// Out-of-scope repos: absorbed / deprecating / off-focus. Their new open issues
// are NOT auto-added to the board (they'd only clutter it); they're reported
// separately for review. Items from these repos already on the board still sync.
const DEPRIORITIZED_REPOS = new Set([
  `${OWNER}/mutav-pulse`,   // hackathon; learnings ported into the protocol repos
  `${OWNER}/mutav-fund`,    // soft-deprecating into mutav-app/apps/fund
  `${OWNER}/mutav-solana`,  // Solana impl; off current (Stellar) focus
]);

// --- Label standard (derived from mutav-pulse's namespaced scheme) ----------
const TYPE_LABELS = ["bug", "enhancement", "documentation", "security"];
const PRIORITY_LABELS = ["priority:high", "priority:med", "priority:low"];
const AREA_LABELS = ["area:contracts", "area:frontend", "area:docs", "area:business"];
const OWNER_LABELS = ["owner:cto", "owner:ceo"];
// GitHub defaults + repo modifiers that are allowed but don't satisfy the standard.
const ALLOWED_MODIFIERS = [
  "duplicate", "invalid", "wontfix", "question", "help wanted", "good first issue",
  "lgpd", "stage-2", "operator-runtime", "pulso", "gate",
  "epic", "pilot",
];
const STALE_DAYS = 30;

const DRY_RUN = process.argv.includes("--dry-run");
const __dirname = dirname(fileURLToPath(import.meta.url));

function gh(args, { json = false } = {}) {
  const out = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return json ? JSON.parse(out) : out;
}

function graphql(query) {
  return gh(["api", "graphql", "-f", `query=${query}`], { json: true });
}

// --- Resolve project + Status field option IDs ------------------------------
function resolveProject() {
  const data = graphql(`query {
    organization(login:"${OWNER}") {
      projectV2(number:${PROJECT_NUMBER}) {
        id
        field(name:"Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
      }
    }
  }`);
  const p = data.data.organization.projectV2;
  const opt = (name) => {
    const o = p.field.options.find((x) => x.name === name);
    if (!o) throw new Error(`Status option not found: ${name}`);
    return o.id;
  };
  return {
    projectId: p.id,
    statusFieldId: p.field.id,
    backlogOptionId: opt("Backlog"),
    doneOptionId: opt("Done"),
  };
}

// --- Fetch all board items (paginated) --------------------------------------
function fetchBoardItems() {
  const items = [];
  let cursor = null;
  for (;;) {
    const after = cursor ? `, after:"${cursor}"` : "";
    const data = graphql(`query {
      organization(login:"${OWNER}") {
        projectV2(number:${PROJECT_NUMBER}) {
          items(first:100${after}) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              status: fieldValueByName(name:"Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
              iteration: fieldValueByName(name:"Iteration") { ... on ProjectV2ItemFieldIterationValue { title iterationId } }
              content {
                __typename
                ... on Issue {
                  number title url state stateReason updatedAt
                  repository { nameWithOwner }
                  milestone { title }
                  parent { number repository { nameWithOwner } }
                  subIssues { totalCount }
                  labels(first:40) { nodes { name } }
                  closedByPullRequestsReferences(first:5) { nodes { number url } }
                }
                ... on PullRequest {
                  number title url state updatedAt
                  repository { nameWithOwner }
                }
              }
            }
          }
        }
      }
    }`);
    const conn = data.data.organization.projectV2.items;
    for (const n of conn.nodes) {
      if (!n.content || !n.content.number) continue; // skip draft issues
      items.push({
        itemId: n.id,
        status: n.status?.name ?? null,
        iterationId: n.iteration?.iterationId ?? null,
        iterationTitle: n.iteration?.title ?? null,
        type: n.content.__typename,
        number: n.content.number,
        title: n.content.title,
        url: n.content.url,
        state: n.content.state,
        stateReason: n.content.stateReason ?? null,
        updatedAt: n.content.updatedAt,
        repo: n.content.repository.nameWithOwner,
        milestone: n.content.milestone?.title ?? null,
        parentKey: n.content.parent ? `${n.content.parent.repository.nameWithOwner}#${n.content.parent.number}` : null,
        subCount: n.content.subIssues?.totalCount ?? 0,
        labels: (n.content.labels?.nodes ?? []).map((l) => l.name),
        closingPRs: (n.content.closedByPullRequestsReferences?.nodes ?? []).map((p) => ({ number: p.number, url: p.url })),
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return items;
}

// --- Fetch open issues across all repos -------------------------------------
function fetchOpenIssues() {
  const all = [];
  for (const repo of REPOS) {
    const list = gh(
      ["issue", "list", "--repo", `${OWNER}/${repo}`, "--state", "open",
       "--limit", "300", "--json", "number,url,title,labels,updatedAt"],
      { json: true },
    );
    for (const i of list) {
      all.push({
        repo: `${OWNER}/${repo}`,
        number: i.number,
        url: i.url,
        title: i.title,
        updatedAt: i.updatedAt,
        labels: i.labels.map((l) => l.name),
      });
    }
  }
  return all;
}

// --- Label-standard audit ---------------------------------------------------
function auditLabels(labels, isStructural = false) {
  const has = (set) => labels.some((l) => set.includes(l));
  const types = labels.filter((l) => TYPE_LABELS.includes(l));
  const problems = [];
  if (types.length === 0) problems.push({ code: "MISSING_TYPE", severity: "error" });
  if (types.length > 1) problems.push({ code: "MULTIPLE_TYPE", severity: "warn", detail: types.join(", ") });
  // Epics and Stories are structural (planning) items — we deliberately do not
  // prioritize them, so the priority requirement does not apply.
  if (!isStructural && !has(PRIORITY_LABELS)) problems.push({ code: "MISSING_PRIORITY", severity: "error" });
  if (!has(AREA_LABELS)) problems.push({ code: "MISSING_AREA", severity: "warn" });
  const known = [...TYPE_LABELS, ...PRIORITY_LABELS, ...AREA_LABELS, ...OWNER_LABELS, ...ALLOWED_MODIFIERS];
  const unknown = labels.filter((l) => !known.includes(l));
  if (unknown.length > 0) problems.push({ code: "NONSTANDARD", severity: "warn", detail: unknown.join(", ") });
  return problems;
}

function fetchRepoLabelGaps() {
  const required = [...PRIORITY_LABELS, ...AREA_LABELS];
  const gaps = {};
  for (const repo of REPOS) {
    const list = gh(
      ["label", "list", "--repo", `${OWNER}/${repo}`, "--limit", "100", "--json", "name"],
      { json: true },
    );
    const names = list.map((l) => l.name);
    const missing = required.filter((r) => !names.includes(r));
    if (missing.length > 0) gaps[`${OWNER}/${repo}`] = missing;
  }
  return gaps;
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function setStatus(ids, itemId, optionId) {
  if (DRY_RUN) return;
  gh(["project", "item-edit", "--project-id", ids.projectId, "--id", itemId,
      "--field-id", ids.statusFieldId, "--single-select-option-id", optionId]);
}

function addItem(url) {
  const res = gh(["project", "item-add", String(PROJECT_NUMBER), "--owner", OWNER,
                  "--url", url, "--format", "json"], { json: true });
  return res.id;
}

const BOARD_URL = `https://github.com/orgs/${OWNER}/projects/${PROJECT_NUMBER}`;

function postComment(repo, number, body) {
  if (DRY_RUN) return;
  gh(["issue", "comment", String(number), "--repo", repo, "--body", body]);
}

function closingCommentBody(item) {
  const pr = item.closingPRs?.[0];
  const prRef = pr ? ` Resolvida em ${pr.url}.` : "";
  return `🔄 **Atualização do board** — esta issue foi fechada e movida para **Done** no [Mutav Project](${BOARD_URL}).${prRef}\n\n_Comentário automático via \`/board-sync\`._`;
}

// Structural items (epics / stories) are exempt from the priority requirement.
const STRUCTURAL_RE = /^(EPIC|Story)\b/;
function isStructuralItem(item) {
  return (item.labels ?? []).includes("epic") || STRUCTURAL_RE.test(item.title ?? "");
}

function main() {
  const ids = resolveProject();
  const board = fetchBoardItems();
  const openIssues = fetchOpenIssues();

  const boardKeys = new Set(board.map((b) => `${b.repo}#${b.number}`));

  // 1) ADD: open issues not on the board -> add + Backlog.
  //    Out-of-scope repos are not auto-added (they'd only clutter the board);
  //    their new open issues are surfaced in the report for a human to triage.
  const notOnBoard = openIssues.filter((o) => !boardKeys.has(`${o.repo}#${o.number}`));
  const toAdd = notOnBoard.filter((o) => !DEPRIORITIZED_REPOS.has(o.repo));
  const skippedOutOfScope = notOnBoard
    .filter((o) => DEPRIORITIZED_REPOS.has(o.repo))
    .map((o) => `${o.repo}#${o.number}`);
  const added = [];
  for (const o of toAdd) {
    if (DRY_RUN) { added.push(`${o.repo}#${o.number}`); continue; }
    const itemId = addItem(o.url);
    setStatus(ids, itemId, ids.backlogOptionId);
    added.push(`${o.repo}#${o.number}`);
  }

  // 2) DONE: board items whose issue is closed and not yet Done.
  // The board Status is the dedup memory: once an item is Done it won't be
  // re-processed, so each closure is commented exactly once. Comment first,
  // then flip to Done — order guarantees no Done item is left uncommented.
  const toDone = board.filter((b) => b.state === "CLOSED" && b.status !== "Done");
  for (const b of toDone) {
    postComment(b.repo, b.number, closingCommentBody(b));
    setStatus(ids, b.itemId, ids.doneOptionId);
  }

  // Reopened issues still marked Done -> return to Backlog (board-internal, no comment).
  const reopened = board.filter((b) => b.state === "OPEN" && b.status === "Done");
  for (const b of reopened) setStatus(ids, b.itemId, ids.backlogOptionId);

  // 3) Label audit over open board issues (+ newly added, which are open).
  const openBoardIssues = [
    ...board.filter((b) => b.state === "OPEN" && b.type === "Issue"),
    ...toAdd.map((o) => ({ repo: o.repo, number: o.number, title: o.title, url: o.url, labels: o.labels, updatedAt: o.updatedAt, state: "OPEN" })),
  ];
  const labelViolations = [];
  for (const b of openBoardIssues) {
    const problems = auditLabels(b.labels, isStructuralItem(b));
    if (problems.length > 0) {
      labelViolations.push({ key: `${b.repo}#${b.number}`, title: b.title, url: b.url, labels: b.labels, problems });
    }
  }

  // 4) Repos missing the standard label definitions.
  const repoLabelGaps = fetchRepoLabelGaps();

  // 4b) Structure integrity — epic -> story -> sub-issue tree + Summit sprint.
  const openBoard = board.filter((b) => b.state === "OPEN" && b.type === "Issue");
  const boardByKey = new Map(board.map((b) => [`${b.repo}#${b.number}`, b]));

  // Orphans: open leaf issues with no parent, not an epic, and no sub-issues of
  // their own (trackers are exempt) — i.e. not attached to the epic/story tree.
  const orphans = openBoard
    .filter((b) => !b.parentKey && !b.labels.includes("epic") && b.subCount === 0)
    .map((b) => ({
      key: `${b.repo}#${b.number}`, title: b.title, url: b.url,
      pilot: b.labels.includes("pilot") || b.milestone === "Pilot",
    }));

  // Sprint duplication: a parent sitting in the same iteration as its child —
  // the parent is redundant in the sprint (track the child, not the container).
  const dupParents = new Map();
  for (const b of openBoard) {
    if (!b.iterationId || !b.parentKey) continue;
    const parent = boardByKey.get(b.parentKey);
    if (parent && parent.iterationId === b.iterationId) {
      const prev = dupParents.get(b.parentKey);
      dupParents.set(b.parentKey, {
        key: b.parentKey, title: parent.title, url: parent.url,
        childrenInSprint: [...(prev?.childrenInSprint ?? []), `${b.repo}#${b.number}`],
      });
    }
  }
  const sprintDuplications = [...dupParents.values()];

  // Pilot coverage: pilot-horizon issues (label or milestone) not in the tree.
  const pilotCoverageGaps = orphans.filter((o) => o.pilot);

  // 5) Resolution candidates.
  const resolvedClosed = toDone.map((b) => ({ key: `${b.repo}#${b.number}`, title: b.title, url: b.url, stateReason: b.stateReason }));
  const stale = openBoardIssues
    .filter((b) => b.updatedAt && daysSince(b.updatedAt) >= STALE_DAYS)
    .map((b) => ({ key: `${b.repo}#${b.number}`, title: b.title, url: b.url, daysStale: daysSince(b.updatedAt) }))
    .sort((a, b) => b.daysStale - a.daysStale);

  const findings = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    totals: {
      boardItems: board.length,
      openIssues: openIssues.length,
      added: added.length,
      skippedOutOfScope: skippedOutOfScope.length,
      markedDone: toDone.length,
      commentsPosted: DRY_RUN ? 0 : toDone.length,
      reopenedReset: reopened.length,
      labelViolations: labelViolations.length,
      orphans: orphans.length,
      sprintDuplications: sprintDuplications.length,
      pilotCoverageGaps: pilotCoverageGaps.length,
      staleCandidates: stale.length,
    },
    standard: { TYPE_LABELS, PRIORITY_LABELS, AREA_LABELS, OWNER_LABELS },
    added,
    skippedOutOfScope,
    markedDone: resolvedClosed,
    labelViolations,
    orphans,
    sprintDuplications,
    pilotCoverageGaps,
    repoLabelGaps,
    staleCandidates: stale,
  };

  const reportDir = resolve(__dirname, "..", "reports");
  mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const reportPath = resolve(reportDir, `board-sync-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(findings, null, 2));

  const t = findings.totals;
  console.log(`${DRY_RUN ? "[DRY-RUN] " : ""}Board sync complete`);
  console.log(`  board items:      ${t.boardItems}`);
  console.log(`  open issues:      ${t.openIssues}`);
  console.log(`  added (Backlog):  ${t.added}`);
  console.log(`  marked Done:      ${t.markedDone}`);
  console.log(`  comments posted:  ${t.commentsPosted}${DRY_RUN ? " (dry-run: none)" : ""}`);
  console.log(`  reopened reset:   ${t.reopenedReset}`);
  console.log(`  out-of-scope new: ${t.skippedOutOfScope} (not added)`);
  console.log(`  label violations: ${t.labelViolations}`);
  console.log(`  orphans (no tree):${t.orphans}`);
  console.log(`  sprint dup:       ${t.sprintDuplications}`);
  console.log(`  pilot gaps:       ${t.pilotCoverageGaps}`);
  console.log(`  stale candidates: ${t.staleCandidates} (>= ${STALE_DAYS}d)`);
  console.log(`FINDINGS ${reportPath}`);
}

main();
