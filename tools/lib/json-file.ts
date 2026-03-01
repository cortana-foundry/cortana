import fs from "fs";
import path from "path";

export function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return safeJsonParse<T>(raw);
  } catch {
    return null;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

export function writeJsonFileAtomic(filePath: string, data: unknown, indent = 2): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const payload = JSON.stringify(data, null, indent) + "\n";
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`
  );

  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, filePath);
}

export function rotateBackupRing(filePath: string, size = 3): void {
  if (!fs.existsSync(filePath)) return;
  for (let i = size; i >= 1; i -= 1) {
    const from = i === 1 ? filePath : `${filePath}.bak.${i - 1}`;
    const to = `${filePath}.bak.${i}`;
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  }
}

export function acquireFileLock(filePath: string, timeoutMs = 5000, pollMs = 100): () => void {
  const lockPath = `${filePath}.lock`;
  const start = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}:${Date.now()}\n`, "utf8");
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // noop
        }
      };
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`Timed out acquiring lock for ${filePath} after ${timeoutMs}ms`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
    }
  }
}

export function withFileLock<T>(filePath: string, timeoutMs: number, fn: () => T): T {
  const release = acquireFileLock(filePath, timeoutMs);
  try {
    return fn();
  } finally {
    release();
  }
}
