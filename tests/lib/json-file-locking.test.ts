import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireFileLock, rotateBackupRing } from "../../tools/lib/json-file.js";

describe("json-file locking + backups", () => {
  it("times out when lock is already held", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-lock-"));
    const file = path.join(dir, "state.json");
    fs.writeFileSync(file, "{}\n", "utf8");

    const release = acquireFileLock(file, 5000, 10);
    try {
      expect(() => acquireFileLock(file, 50, 10)).toThrow(/Timed out acquiring lock/);
    } finally {
      release();
    }
  });

  it("rotates backups in ring order", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-bak-"));
    const file = path.join(dir, "state.json");
    fs.writeFileSync(file, "v3", "utf8");
    fs.writeFileSync(`${file}.bak.1`, "v2", "utf8");
    fs.writeFileSync(`${file}.bak.2`, "v1", "utf8");

    rotateBackupRing(file, 3);

    expect(fs.readFileSync(`${file}.bak.1`, "utf8")).toBe("v3");
    expect(fs.readFileSync(`${file}.bak.2`, "utf8")).toBe("v2");
    expect(fs.readFileSync(`${file}.bak.3`, "utf8")).toBe("v1");
  });
});
