import fs from 'node:fs';
import path from 'node:path';

describe('tools/feedback/log-feedback.ts', () => {
  const filePath = path.resolve(process.cwd(), 'tools/feedback/log-feedback.ts');

  it('has no exported functions (CLI-only module)', () => {
    const source = fs.readFileSync(filePath, 'utf8');
    const exportedFns = source.match(/export\s+function\s+/g) ?? [];
    expect(exportedFns.length).toBe(0);
  });

  it('skips direct import testing because module executes main() at top-level', () => {
    const source = fs.readFileSync(filePath, 'utf8');
    expect(source).toContain('main()');
  });
});
