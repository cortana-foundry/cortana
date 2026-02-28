import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot, getScriptDir } from '../../tools/lib/paths';

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
});
