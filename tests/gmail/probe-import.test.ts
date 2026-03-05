import { afterEach, describe, expect, it, vi } from "vitest";
import { flushModuleSideEffects, importFresh, resetProcess } from "../test-utils";

describe("gmail db import interop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetProcess();
  });

  it("loads withPostgresPath from default db export", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await importFresh("../../tools/gmail/_probe-import.ts");
    await flushModuleSideEffects();

    expect(logSpy).toHaveBeenCalledWith("type", "function");
  });
});
