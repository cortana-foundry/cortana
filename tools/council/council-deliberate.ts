#!/usr/bin/env npx tsx

import { spawnSync } from "child_process";
import path from "path";
import { getScriptDir } from "../lib/paths.js";

function jsonError(msg: string): string { return JSON.stringify({ ok: false, error: msg }); }
function die(msg: string): never { console.log(jsonError(msg)); process.exit(1); }
function usage() { console.log(`Usage:\n  council-deliberate.sh --title <title> --participants "a,b" --context <json> [--expires <minutes>] [--initiator <name>]`); }

function run(file: string, args: string[]): string {
  const r = spawnSync("tsx", [file, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || "command failed");
  return (r.stdout || "").trim();
}

async function main(): Promise<void> {
  let title = ""; let participants = ""; let context = "{}"; let expires = "30"; let initiator = "cortana";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--title") title = args[++i] || "";
    else if (a === "--participants") participants = args[++i] || "";
    else if (a === "--context") context = args[++i] || "";
    else if (a === "--expires") expires = args[++i] || "";
    else if (a === "--initiator") initiator = args[++i] || "";
    else if (a === "-h" || a === "--help") { usage(); process.exit(0); }
    else die(`Unknown arg: ${a}`);
  }
  if (!(title && participants)) die("Missing required --title and --participants");
  if (!/^\d+$/.test(expires)) die("--expires must be integer minutes");

  const scriptDir = getScriptDir(import.meta.url);
  const councilTs = path.join(scriptDir, "council.ts");
  let createOut = "";
  try {
    createOut = run(councilTs, ["create", "--type", "deliberation", "--title", title, "--initiator", initiator, "--participants", participants, "--expires", expires, "--context", context]);
  } catch {
    die("Failed to create deliberation session");
  }

  const obj = JSON.parse(createOut);
  if (!obj.ok) { console.log(JSON.stringify(obj)); process.exit(1); }
  const parts = participants.split(",").map((p) => p.trim()).filter(Boolean);
  console.log(JSON.stringify({ ok: true, action: "deliberate", session_id: obj.session.id, title: obj.session.title, participants: parts, participant_count: parts.length, expires_at: obj.session.expires_at, context: obj.session.context ?? {} }));
}

main();
