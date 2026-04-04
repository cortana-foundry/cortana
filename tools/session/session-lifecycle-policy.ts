#!/usr/bin/env npx tsx
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

type Bucket = 'chat' | 'subagent' | 'cron' | 'other';

type Target = { maxEntries: number; pruneAfter: string };

type Policy = {
  version: number;
  targets: Record<Bucket, Target>;
};

type SessionItem = {
  key?: string;
  sessionKey?: string;
  updatedAt?: number;
  agentId?: string;
  sessionId?: string;
};

type CleanupResult = {
  ok: boolean;
  changedCount: number;
  raw: string;
  error?: string;
};

type Mode = 'text' | 'json';

type Report = {
  status: 'healthy' | 'remediated' | 'cleanup_failed' | 'breach_persists';
  beforeCounts: Record<Bucket, number>;
  afterCounts: Record<Bucket, number>;
  breachesBefore: Array<{ bucket: Bucket; count: number; max: number }>;
  breachesAfter: Array<{ bucket: Bucket; count: number; max: number }>;
  cleanupChangedCount: number;
  cleanupOk: boolean;
  cleanupError?: string;
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const POLICY_BASENAME = 'session-lifecycle-policy.json';

type SessionRecord = {
  key: string;
  updatedAt: number;
  agentId: string;
  sessionId: string;
};

export function resolvePolicyPath(explicitPath = process.env.SESSION_LIFECYCLE_POLICY_PATH): string {
  const candidates = [
    explicitPath,
    path.join(REPO_ROOT, 'config', POLICY_BASENAME),
    path.join(process.cwd(), 'config', POLICY_BASENAME),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    `session lifecycle policy config not found. Tried: ${candidates.join(', ') || '(no candidate paths)'}`
  );
}

function loadPolicy(): Policy {
  const policyPath = resolvePolicyPath();
  return JSON.parse(fs.readFileSync(policyPath, 'utf8')) as Policy;
}

function classify(key: string): Bucket {
  if (key.includes(':subagent:')) return 'subagent';
  if (key.includes(':cron:')) return 'cron';
  if (key.includes(':telegram:') || key.includes(':webchat:') || key.includes(':discord:') || key.includes(':signal:') || key.includes(':imessage:')) return 'chat';
  return 'other';
}

function parseCliJson(raw: string) {
  const start = raw.search(/[\[{]/);
  if (start < 0) throw new Error('openclaw sessions did not return JSON');
  return JSON.parse(raw.slice(start));
}

function getSessions(): SessionRecord[] {
  const proc = spawnSync('openclaw', ['sessions', '--all-agents', '--json'], { encoding: 'utf8' });
  if (proc.status !== 0) {
    throw new Error(proc.stderr || proc.stdout || 'openclaw sessions failed');
  }
  const raw = parseCliJson(proc.stdout || '{}');
  const sessions: SessionItem[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.sessions)
      ? raw.sessions
      : [];
  return sessions
    .map((s) => ({
      key: s.sessionKey || s.key,
      updatedAt: Number(s.updatedAt ?? 0),
      agentId: String(s.agentId ?? ''),
      sessionId: String(s.sessionId ?? ''),
    }))
    .filter((v): v is SessionRecord => Boolean(v.key && v.agentId && v.sessionId));
}

function countBuckets(keys: string[]): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { chat: 0, subagent: 0, cron: 0, other: 0 };
  for (const key of keys) counts[classify(key)] += 1;
  return counts;
}

function getBreaches(policy: Policy, counts: Record<Bucket, number>) {
  return Object.entries(policy.targets)
    .map(([bucket, target]) => ({ bucket: bucket as Bucket, count: counts[bucket as Bucket], max: target.maxEntries }))
    .filter((x) => x.count > x.max);
}

function getActionableBreaches(policy: Policy, records: SessionRecord[], now = Date.now()) {
  const counts = countBuckets(records.map((record) => record.key));
  return (Object.entries(policy.targets) as Array<[Bucket, Target]>)
    .map(([bucket, target]) => {
      const eligible = records.filter((record) => classify(record.key) === bucket && now - record.updatedAt >= parseDurationMs(target.pruneAfter)).length;
      return { bucket, count: counts[bucket], max: target.maxEntries, eligible };
    })
    .filter((entry) => entry.count > entry.max && entry.eligible > 0)
    .map(({ bucket, count, max }) => ({ bucket, count, max }));
}

function runCleanup(): CleanupResult {
  const proc = spawnSync('openclaw', ['sessions', 'cleanup', '--all-agents', '--enforce', '--json'], { encoding: 'utf8' });
  const raw = `${proc.stdout ?? ''}${proc.stderr ?? ''}`.trim();
  if (proc.status !== 0) {
    return { ok: false, changedCount: 0, raw, error: raw || 'openclaw sessions cleanup failed' };
  }

  let changedCount = 0;
  try {
    const parsed = parseCliJson(proc.stdout || '{}');
    const candidates = [
      parsed?.changedCount,
      parsed?.cleanedCount,
      parsed?.removedCount,
      parsed?.summary?.changedCount,
      parsed?.summary?.cleanedCount,
      parsed?.summary?.removedCount,
      Array.isArray(parsed?.changed) ? parsed.changed.length : undefined,
      Array.isArray(parsed?.cleaned) ? parsed.cleaned.length : undefined,
      Array.isArray(parsed?.removed) ? parsed.removed.length : undefined,
    ].filter((v) => typeof v === 'number' && Number.isFinite(v)) as number[];
    changedCount = candidates.length ? Math.max(...candidates) : 0;
  } catch {
    changedCount = 0;
  }

  return { ok: true, changedCount, raw };
}

function parseDurationMs(value: string): number {
  const match = /^(\d+)([mhd])$/.exec(value.trim());
  if (!match) throw new Error(`unsupported duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return amount * 60_000;
  if (unit === 'h') return amount * 60 * 60_000;
  return amount * 24 * 60 * 60_000;
}

function sessionFilePath(agentId: string, sessionId: string): string {
  return path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
}

function storePath(agentId: string): string {
  return path.join(os.homedir(), '.openclaw', 'agents', agentId, 'sessions', 'sessions.json');
}

function archiveSuffix(now: Date) {
  return `.deleted.${now.toISOString().replace(/:/g, '-')}`;
}

function prunePersistedSessions(records: SessionRecord[], policy: Policy, now = new Date()): CleanupResult {
  const counts = countBuckets(records.map((record) => record.key));
  const breaches = getBreaches(policy, counts);
  if (breaches.length === 0) return { ok: true, changedCount: 0, raw: 'no direct prune needed' };

  const selected = new Map<string, SessionRecord>();
  const nowMs = now.getTime();

  for (const breach of breaches) {
    const thresholdMs = parseDurationMs(policy.targets[breach.bucket].pruneAfter);
    const eligible = records
      .filter((record) => classify(record.key) === breach.bucket && nowMs - record.updatedAt >= thresholdMs)
      .sort((a, b) => a.updatedAt - b.updatedAt);
    const need = breach.count - breach.max;
    for (const record of eligible.slice(0, need)) {
      selected.set(record.key, record);
    }
  }

  if (selected.size === 0) return { ok: true, changedCount: 0, raw: 'no eligible sessions to prune' };

  const byAgent = new Map<string, Record<string, unknown>>();
  for (const record of selected.values()) {
    const candidateStorePath = storePath(record.agentId);
    if (!byAgent.has(record.agentId) && fs.existsSync(candidateStorePath)) {
      byAgent.set(record.agentId, JSON.parse(fs.readFileSync(candidateStorePath, 'utf8')) as Record<string, unknown>);
    }
  }

  for (const record of selected.values()) {
    const jsonl = sessionFilePath(record.agentId, record.sessionId);
    const suffix = archiveSuffix(now);
    if (fs.existsSync(jsonl)) fs.renameSync(jsonl, `${jsonl}${suffix}`);
    const lockFile = `${jsonl}.lock`;
    if (fs.existsSync(lockFile)) fs.rmSync(lockFile, { force: true });
    const store = byAgent.get(record.agentId);
    if (store && record.key in store) delete store[record.key];
  }

  for (const [agentId, store] of byAgent.entries()) {
    const candidateStorePath = storePath(agentId);
    if (!fs.existsSync(candidateStorePath)) continue;
    fs.copyFileSync(candidateStorePath, `${candidateStorePath}.bak`);
    fs.writeFileSync(candidateStorePath, `${JSON.stringify(store, null, 2)}\n`);
  }

  return { ok: true, changedCount: selected.size, raw: `directly pruned ${selected.size} persisted session(s)` };
}

function formatCounts(counts: Record<Bucket, number>) {
  return `chat=${counts.chat}, subagent=${counts.subagent}, cron=${counts.cron}, other=${counts.other}`;
}

function evaluate(): Report {
  const policy = loadPolicy();
  const beforeRecords = getSessions();
  const beforeCounts = countBuckets(beforeRecords.map((record) => record.key));
  const breachesBefore = getActionableBreaches(policy, beforeRecords);

  if (breachesBefore.length === 0) {
    return {
      status: 'healthy',
      beforeCounts,
      afterCounts: beforeCounts,
      breachesBefore,
      breachesAfter: breachesBefore,
      cleanupChangedCount: 0,
      cleanupOk: true,
    };
  }

  const cleanup = runCleanup();
  if (!cleanup.ok) {
    return {
      status: 'cleanup_failed',
      beforeCounts,
      afterCounts: beforeCounts,
      breachesBefore,
      breachesAfter: breachesBefore,
      cleanupChangedCount: 0,
      cleanupOk: false,
      cleanupError: cleanup.error,
    };
  }

  const afterRecords = getSessions();
  const afterCounts = countBuckets(afterRecords.map((record) => record.key));
  const breachesAfter = getActionableBreaches(policy, afterRecords);

  if (breachesAfter.length === 0) {
    return {
      status: 'remediated',
      beforeCounts,
      afterCounts,
      breachesBefore,
      breachesAfter,
      cleanupChangedCount: cleanup.changedCount,
      cleanupOk: true,
    };
  }

  const directPrune = prunePersistedSessions(afterRecords, policy);
  const finalRecords = directPrune.changedCount > 0 ? getSessions() : afterRecords;
  const finalCounts = countBuckets(finalRecords.map((record) => record.key));
  const breachesFinal = getActionableBreaches(policy, finalRecords);

  if (breachesFinal.length === 0) {
    return {
      status: 'remediated',
      beforeCounts,
      afterCounts: finalCounts,
      breachesBefore,
      breachesAfter: breachesFinal,
      cleanupChangedCount: cleanup.changedCount + directPrune.changedCount,
      cleanupOk: true,
    };
  }

  return {
    status: 'breach_persists',
    beforeCounts,
    afterCounts: finalCounts,
    breachesBefore,
    breachesAfter: breachesFinal,
    cleanupChangedCount: cleanup.changedCount + directPrune.changedCount,
    cleanupOk: true,
  };
}

function parseMode(argv: string[]): Mode {
  return argv.includes('--json') ? 'json' : 'text';
}

export function main() {
  const mode = parseMode(process.argv.slice(2));
  const report = evaluate();

  if (mode === 'json') {
    console.log(JSON.stringify(report));
    return;
  }

  if (report.status === 'healthy' || report.status === 'remediated') {
    console.log('NO_REPLY');
    return;
  }

  if (report.status === 'cleanup_failed') {
    const lines = [
      '⚠️ Session lifecycle cleanup failed',
      `Counts: ${formatCounts(report.beforeCounts)}`,
      ...report.breachesBefore.map((b) => `- ${b.bucket}: ${b.count} > ${b.max}`),
      `Root cause: cleanup command failed (${report.cleanupError})`,
      'Next: inspect session churn and rerun cleanup manually.',
    ];
    console.log(lines.join('\n'));
    return;
  }

  const lines = [
    '⚠️ Session lifecycle breach persists after cleanup',
    `Before: ${formatCounts(report.beforeCounts)}`,
    `After: ${formatCounts(report.afterCounts)}`,
    `Cleanup changed: ${report.cleanupChangedCount}`,
    ...report.breachesAfter.map((b) => `- ${b.bucket}: ${b.count} > ${b.max}`),
    'Next: inspect churn source and tighten session lifecycle caps or offending workflows.',
  ];
  console.log(lines.join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
