export type MainCleanEvaluation = {
  ok: boolean;
  reasons: string[];
  ahead: number;
  behind: number;
};

export function parseAheadBehindCounts(raw: string): { ahead: number; behind: number } {
  const cleaned = raw.trim();
  const match = cleaned.match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    throw new Error(`unable to parse ahead/behind counts: ${raw}`);
  }

  // git rev-list --left-right --count origin/main...main
  // returns: <left-only> <right-only>
  // left-only = behind, right-only = ahead
  const behind = Number(match[1]);
  const ahead = Number(match[2]);
  return { ahead, behind };
}

export function evaluateMainClean(statusPorcelain: string, aheadBehindRaw: string): MainCleanEvaluation {
  const reasons: string[] = [];
  const workingTreeDirty = statusPorcelain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length > 0;

  if (workingTreeDirty) {
    reasons.push("working tree is dirty (commit/stash/discard local changes)");
  }

  const { ahead, behind } = parseAheadBehindCounts(aheadBehindRaw);

  if (ahead > 0) {
    reasons.push(`local main is ahead of origin/main by ${ahead} commit(s)`);
  }
  if (behind > 0) {
    reasons.push(`local main is behind origin/main by ${behind} commit(s)`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    ahead,
    behind,
  };
}
