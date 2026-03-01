import { afterEach, describe, expect, it } from "vitest";
import { flushModuleSideEffects, captureConsole, importFresh, mockExit, resetProcess, setArgv } from "../test-utils";

afterEach(() => {
  resetProcess();
});

describe("extract-facts", () => {
  it("prints help when no args", async () => {
    const exitSpy = mockExit();
    const consoleCapture = captureConsole();
    setArgv([]);

    await importFresh("../../tools/memory/extract_facts.ts");
    await flushModuleSideEffects();
    expect(consoleCapture.logs.join(" ")).toContain("Extract atomic facts");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("rejects unknown command", async () => {
    const exitSpy = mockExit();
    const consoleCapture = captureConsole();
    setArgv(["nonsense"]);

    await importFresh("../../tools/memory/extract_facts.ts");
    await flushModuleSideEffects();
    expect(consoleCapture.errors.join(" ")).toContain("Unknown command");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("requires input for extract", async () => {
    const exitSpy = mockExit();
    const consoleCapture = captureConsole();
    setArgv(["extract"]);

    await importFresh("../../tools/memory/extract_facts.ts");
    await flushModuleSideEffects();
    expect(consoleCapture.errors.join(" ")).toContain("--input is required");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});
