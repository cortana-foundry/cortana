#!/usr/bin/env -S npx tsx
import fs from "node:fs";
import { execSync } from "node:child_process";
import { reconcileMissionControlFeedbackSignal } from "../feedback/mission-control-feedback-signal.js";

type Args = {
  dryRun: boolean;
  json: boolean;
  sourceRepo: string;
  runtimeRepo: string;
  sourceBranch: string;
  runtimeBranch: string;
};

type Check = {
  label: string;
  repo: string;
};

type DriftAssessment = {
  check: Check;
  actionable: boolean;
  reason: string;
  details?: Record<string, string>;
};

type RepoState = {
  repo: string;
  branch: string;
  upstream: string;
  head: string;
  trackedRef: string;
  trackedHead: string;
  trackedRemoteUrl: string;
  clean: boolean;
  changedPaths: string[];
};

const FALLBACK_SOURCE_REPO = "/Users/hd/Developer/cortana";
const DEFAULT_DEPLOY_REPO = process.env.CORTANA_DEPLOY_REPO || "/Users/hd/Developer/cortana-deploy";
const IGNORED_RUNTIME_STATE_PATHS = new Set([
  "memory/apple-reminders-sent.json",
  "var/backtests/rechecks/state.json",
]);

function resolveDefaultSourceRepo(): string {
  if (repoExists(DEFAULT_DEPLOY_REPO)) return DEFAULT_DEPLOY_REPO;
  return process.env.CORTANA_SOURCE_REPO || FALLBACK_SOURCE_REPO;
}

function resolveDefaultRuntimeRepo(sourceRepo: string): string {
  const configured = process.env.CORTANA_RUNTIME_REPO;
  if (configured) return configured;
  const compatRepo = "/Users/hd/openclaw";
  if (repoExists(compatRepo) || pathExists(compatRepo)) return compatRepo;
  return sourceRepo;
}

const DEFAULT_SOURCE_REPO = resolveDefaultSourceRepo();
const DEFAULT_RUNTIME_REPO = resolveDefaultRuntimeRepo(DEFAULT_SOURCE_REPO);

function parseArgs(): Args {
  const argv = process.argv.slice(2);

  let dryRun = false;
  let json = false;
  let sourceRepo = DEFAULT_SOURCE_REPO;
  let runtimeRepo = DEFAULT_RUNTIME_REPO;
  let sourceBranch = "main";
  let runtimeBranch = "main";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--json") json = true;
    else if ((arg === "--source-repo" || arg === "--repo-root") && argv[i + 1]) sourceRepo = argv[++i];
    else if (arg === "--runtime-repo" && argv[i + 1]) runtimeRepo = argv[++i];
    else if (arg === "--source-branch" && argv[i + 1]) sourceBranch = argv[++i];
    else if (arg === "--runtime-branch" && argv[i + 1]) runtimeBranch = argv[++i];
    else if (arg === "--auto-pr" || arg === "--base" || arg === "--branch-prefix") {
      if (argv[i + 1] && arg !== "--auto-pr" && !argv[i + 1].startsWith("--")) i += 1;
    }
  }

  return { dryRun, json, sourceRepo, runtimeRepo, sourceBranch, runtimeBranch };
}

function run(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
}

function tryRun(cmd: string, cwd: string): string {
  try {
    return run(cmd, cwd);
  } catch {
    return "";
  }
}

function repoExists(repo: string): boolean {
  return fs.existsSync(`${repo}/.git`);
}

function pathExists(repo: string): boolean {
  return fs.existsSync(repo);
}

function realpath(repo: string): string {
  return fs.realpathSync.native?.(repo) ?? fs.realpathSync(repo);
}

function normalizeStatusPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return "";
  const renameMarker = " -> ";
  if (trimmed.includes(renameMarker)) {
    return trimmed.split(renameMarker).at(-1)?.trim() ?? trimmed;
  }
  return trimmed;
}

function collectChangedPaths(repo: string): string[] {
  const raw = run("git status --porcelain --untracked-files=all", repo);
  return raw
    .split("\n")
    .map((line) => normalizeStatusPath(line.slice(3)))
    .filter(Boolean);
}

function isMeaningfulDriftPath(repoPath: string): boolean {
  return !IGNORED_RUNTIME_STATE_PATHS.has(repoPath);
}

function isShimmedRuntime(sourceRepo: string, runtimeRepo: string): boolean {
  if (!pathExists(sourceRepo) || !pathExists(runtimeRepo)) return false;
  try {
    return realpath(sourceRepo) === realpath(runtimeRepo);
  } catch {
    return false;
  }
}

function resolveTrackedMainRef(repo: string, branch: string, upstream: string): string {
  if (upstream) return upstream;

  for (const candidate of [`origin/${branch}`, `upstream/${branch}`]) {
    if (tryRun(`git rev-parse ${candidate}`, repo)) return candidate;
  }

  return "";
}

function fetchTrackedMainRef(repo: string, trackedRef: string): void {
  if (!trackedRef) return;
  const [remote, ...branchParts] = trackedRef.split("/");
  const branch = branchParts.join("/");
  if (!remote || !branch) return;
  run(`git fetch ${remote} ${branch} --prune --quiet`, repo);
}

function collectRepoState(repo: string, branch: string): RepoState {
  const upstream = tryRun("git rev-parse --abbrev-ref --symbolic-full-name @{u}", repo);
  const trackedRef = resolveTrackedMainRef(repo, branch, upstream);
  fetchTrackedMainRef(repo, trackedRef);
  const changedPaths = collectChangedPaths(repo);
  const trackedRemote = trackedRef.split("/")[0] ?? "origin";
  return {
    repo,
    branch: run("git rev-parse --abbrev-ref HEAD", repo),
    upstream,
    head: run("git rev-parse HEAD", repo),
    trackedRef,
    trackedHead: trackedRef ? run(`git rev-parse ${trackedRef}`, repo) : "",
    trackedRemoteUrl: trackedRemote ? tryRun(`git remote get-url ${trackedRemote}`, repo) : "",
    clean: changedPaths.every((repoPath) => !isMeaningfulDriftPath(repoPath)),
    changedPaths,
  };
}

function assessSource(state: RepoState, expectedBranch: string): DriftAssessment[] {
  const check: Check = { label: "source-repo", repo: state.repo };
  const findings: DriftAssessment[] = [];

  if (state.branch !== expectedBranch) {
    findings.push({
      check,
      actionable: true,
      reason: "source repo is not on the deploy branch",
      details: { expected: expectedBranch, actual: state.branch },
    });
  }

  if (!state.upstream) {
    findings.push({
      check,
      actionable: true,
      reason: "source repo main has no configured upstream",
      details: { expectedBranch },
    });
  }

  if (!state.clean) {
    findings.push({
      check,
      actionable: true,
      reason: "source repo has local changes",
    });
  }

  if (state.head !== state.trackedHead) {
    findings.push({
      check,
      actionable: true,
      reason: "source repo is not synced with its tracked main remote",
      details: { head: state.head, trackedRef: state.trackedRef, trackedHead: state.trackedHead },
    });
  }

  return findings;
}

function assessRuntime(state: RepoState, source: RepoState, expectedBranch: string): DriftAssessment[] {
  const check: Check = { label: "runtime-repo", repo: state.repo };
  const findings: DriftAssessment[] = [];

  if (state.trackedRemoteUrl !== source.trackedRemoteUrl) {
    findings.push({
      check,
      actionable: true,
      reason: "runtime repo tracked remote does not match source repo tracked remote",
      details: { sourceRemote: source.trackedRemoteUrl, runtimeRemote: state.trackedRemoteUrl },
    });
  }

  if (state.branch !== expectedBranch) {
    findings.push({
      check,
      actionable: true,
      reason: "runtime repo is not on main",
      details: { expected: expectedBranch, actual: state.branch },
    });
  }

  if (!state.upstream) {
    findings.push({
      check,
      actionable: true,
      reason: "runtime repo main has no configured upstream",
      details: { expectedBranch },
    });
  }

  if (!state.clean) {
    findings.push({
      check,
      actionable: true,
      reason: "runtime repo has local changes",
    });
  }

  if (state.head !== source.head) {
    let fastForwardable = false;
    try {
      run(`git merge-base --is-ancestor ${state.head} ${source.head}`, state.repo);
      fastForwardable = true;
    } catch {
      fastForwardable = false;
    }

    findings.push({
      check,
      actionable: true,
      reason: fastForwardable
        ? "runtime repo is behind the source deploy commit"
        : "runtime repo diverged from the source deploy commit",
      details: { runtimeHead: state.head, sourceHead: source.head },
    });
  }

  return findings;
}

async function main(): Promise<void> {
  const args = parseArgs();
  void args.dryRun;

  const missing: DriftAssessment[] = [];
  if (!repoExists(args.sourceRepo)) {
    missing.push({
      check: { label: "source-repo", repo: args.sourceRepo },
      actionable: false,
      reason: "missing repo",
    });
  }
  if (!repoExists(args.runtimeRepo)) {
    missing.push({
      check: { label: "runtime-repo", repo: args.runtimeRepo },
      actionable: false,
      reason: "missing repo",
    });
  }

  if (missing.length) {
    await reconcileMissionControlFeedbackSignal({
      category: "ops.runtime_repo_drift",
      severity: "high",
      summary: "Runtime deploy drift: source or runtime repo is missing.",
      recurrenceKey: "ops:runtime-repo-drift",
      signalState: "active",
      actor: "runtime-repo-drift-monitor",
      owner: "monitor",
      details: { missing },
    });
    const payload = { status: "needs_action", actionable: [], suppressed: [], missing };
    if (args.json) {
      console.log(JSON.stringify(payload));
      return;
    }
    console.log(["🧭 Runtime Deploy Drift", ...missing.map((item) => `- ${item.check.label}: ${item.reason}`)].join("\n"));
    return;
  }

  const sourceState = collectRepoState(args.sourceRepo, args.sourceBranch);
  if (isShimmedRuntime(args.sourceRepo, args.runtimeRepo)) {
    const actionable = assessSource(sourceState, args.sourceBranch);
    await reconcileMissionControlFeedbackSignal({
      category: "ops.runtime_repo_drift",
      severity: actionable.length ? "high" : "low",
      summary: actionable.length
        ? `Runtime deploy drift: ${actionable.length} source repo issue${actionable.length === 1 ? "" : "s"} detected.`
        : "Runtime deploy drift cleared.",
      recurrenceKey: "ops:runtime-repo-drift",
      signalState: actionable.length ? "active" : "cleared",
      actor: "runtime-repo-drift-monitor",
      owner: "monitor",
      details: {
        source_repo: args.sourceRepo,
        runtime_repo: args.runtimeRepo,
        source_of_truth: args.sourceRepo === DEFAULT_DEPLOY_REPO ? "deploy-worktree" : "primary-worktree",
        actionable,
      },
    });
    const payload = {
      status: actionable.length ? "needs_action" : "healthy",
      sourceRepo: args.sourceRepo,
      runtimeRepo: args.runtimeRepo,
      sourceOfTruth: args.sourceRepo === DEFAULT_DEPLOY_REPO ? "deploy-worktree" : "primary-worktree",
      actionable,
      suppressed: [
        {
          check: { label: "runtime-repo", repo: args.runtimeRepo },
          actionable: false,
          reason: "runtime path is a compatibility shim to the source repo",
        },
      ],
      missing: [],
    };

    if (args.json) {
      console.log(JSON.stringify(payload));
      return;
    }

    if (!actionable.length) {
      console.log("NO_REPLY");
      return;
    }

    const lines = ["🧭 Runtime Deploy Drift"];
    for (const item of actionable) {
      lines.push(`- ${item.check.label}: ${item.reason}`);
    }
    lines.push(`- runtime-repo: compatibility shim target=${args.runtimeRepo}`);
    console.log(lines.join("\n"));
    return;
  }

  const runtimeState = collectRepoState(args.runtimeRepo, args.runtimeBranch);
  const actionable = [
    ...assessSource(sourceState, args.sourceBranch),
    ...assessRuntime(runtimeState, sourceState, args.runtimeBranch),
  ];

  await reconcileMissionControlFeedbackSignal({
    category: "ops.runtime_repo_drift",
    severity: actionable.length ? "high" : "low",
    summary: actionable.length
      ? `Runtime deploy drift: ${actionable.length} actionable mismatch${actionable.length === 1 ? "" : "es"} detected.`
      : "Runtime deploy drift cleared.",
    recurrenceKey: "ops:runtime-repo-drift",
    signalState: actionable.length ? "active" : "cleared",
    actor: "runtime-repo-drift-monitor",
    owner: "monitor",
    details: {
      source_repo: args.sourceRepo,
      runtime_repo: args.runtimeRepo,
      actionable,
    },
  });

  const payload = {
    status: actionable.length ? "needs_action" : "healthy",
    sourceRepo: args.sourceRepo,
    runtimeRepo: args.runtimeRepo,
    sourceOfTruth: args.sourceRepo === DEFAULT_DEPLOY_REPO ? "deploy-worktree" : "primary-worktree",
    actionable,
    suppressed: [],
    missing: [],
  };

  if (args.json) {
    console.log(JSON.stringify(payload));
    return;
  }

  if (!actionable.length) {
    console.log("NO_REPLY");
    return;
  }

  const lines = ["🧭 Runtime Deploy Drift"];
  for (const item of actionable) {
    lines.push(`- ${item.check.label}: ${item.reason}`);
  }
  console.log(lines.join("\n"));
}

void main();
