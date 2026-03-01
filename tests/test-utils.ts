import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { vi } from "vitest";

const ORIGINAL_ARGV = process.argv.slice();
const ORIGINAL_ENV = { ...process.env };

export function resetProcess(): void {
  process.argv = ORIGINAL_ARGV.slice();
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

export function setArgv(args: string[]): void {
  process.argv = ["node", "script", ...args];
}

export function mockExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    void code;
    return undefined as never;
  }) as never);
}

export function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  });
  return {
    logs,
    errors,
    warns,
    restore() {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
}

export function captureStdout() {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: any) => {
    writes.push(String(chunk));
    return true;
  }) as never);
  return {
    writes,
    restore() {
      spy.mockRestore();
    },
  };
}

export function captureStderr() {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: any) => {
    writes.push(String(chunk));
    return true;
  }) as never);
  return {
    writes,
    restore() {
      spy.mockRestore();
    },
  };
}

export async function importFresh(importPath: string) {
  vi.resetModules();

  const stack = new Error().stack ?? "";
  const callerFile = stack.match(/(\/[^\s:]+\/tests\/[^\s:]+\.test\.[cm]?[jt]s)/)?.[1];

  const resolvedImport =
    importPath.startsWith(".") && callerFile
      ? pathToFileURL(resolve(dirname(callerFile), importPath)).href
      : importPath;

  return import(resolvedImport);
}

export async function flushModuleSideEffects(): Promise<void> {
  await Promise.resolve();
  if (vi.isFakeTimers()) {
    await vi.runAllTimersAsync();
  }
  await Promise.resolve();
}

export function useFixedTime(iso: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}
