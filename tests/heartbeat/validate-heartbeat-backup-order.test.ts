import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rotateBackupRing } from "../../tools/lib/json-file.js";

describe("heartbeat backup rotation order", () => {
  it("keeps prior state in bak.1 when rotating before write", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-validate-"));
    const stateFile = path.join(dir, "heartbeat-state.json");

    fs.writeFileSync(stateFile, JSON.stringify({ marker: "old" }), "utf8");
    rotateBackupRing(stateFile, 3);
    fs.writeFileSync(stateFile, JSON.stringify({ marker: "new" }), "utf8");

    const backup = JSON.parse(fs.readFileSync(`${stateFile}.bak.1`, "utf8"));
    expect(backup.marker).toBe("old");
  });
});
