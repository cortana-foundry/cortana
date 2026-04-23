import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultHeartbeatStatePath, findRepoRoot, getScriptDir } from '../../tools/lib/paths';

describe('tools/lib/paths', () => {
  it('findRepoRoot returns a valid repo path with AGENTS.md or .git', () => {
    const root = findRepoRoot(path.join(process.cwd(), 'tools', 'lib'));
    expect(typeof root).toBe('string');
    expect(root.length).toBeGreaterThan(0);
    const hasAgents = fs.existsSync(path.join(root, 'AGENTS.md'));
    const hasGit = fs.existsSync(path.join(root, '.git'));
    expect(hasAgents || hasGit).toBe(true);
  });

  it('getScriptDir returns a string path', () => {
    const scriptDir = getScriptDir(import.meta.url);
    expect(typeof scriptDir).toBe('string');
    expect(scriptDir.length).toBeGreaterThan(0);
  });

  it('defaults heartbeat runtime state outside the repo worktree', () => {
    expect(defaultHeartbeatStatePath()).toBe(path.join(os.homedir(), '.openclaw', 'memory', 'heartbeat-state.json'));
  });
});
