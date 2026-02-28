#!/usr/bin/env npx tsx

import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { runPsql, withPostgresPath } from "../../tools/lib/db.js";

type GmailMessage = {
  id?: string;
  subject?: string;
  from?: string;
  labelIds?: string[];
};

const env = {
  ...withPostgresPath(process.env),
  PATH: `/opt/homebrew/bin:${withPostgresPath(process.env).PATH ?? ""}`,
};

function main() {
  const lastFile = path.join(os.homedir(), "clawd/cortical-loop/state/email-last-ids.txt");
  fs.mkdirSync(path.dirname(lastFile), { recursive: true });
  if (!fs.existsSync(lastFile)) fs.writeFileSync(lastFile, "", "utf8");

  let unreadRaw = "";
  try {
    unreadRaw = execFileSync(
      "gog",
      ["--account", "hameldesai3@gmail.com", "gmail", "search", "is:unread", "--max", "10", "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env }
    );
  } catch {
    process.exit(0);
  }

  if (!unreadRaw.trim()) process.exit(0);

  let unread: GmailMessage[] = [];
  try {
    unread = JSON.parse(unreadRaw) as GmailMessage[];
  } catch {
    process.exit(0);
  }

  const currentIds = unread
    .map((m) => m.id ?? "")
    .filter(Boolean)
    .sort();

  if (currentIds.length === 0) process.exit(0);

  const lastIds = new Set(
    fs
      .readFileSync(lastFile, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const newIds = currentIds.filter((id) => !lastIds.has(id));
  if (newIds.length === 0) process.exit(0);

  for (const id of newIds) {
    const msg = unread.find((m) => m.id === id);
    const subject = (msg?.subject ?? "unknown").slice(0, 200);
    const from = (msg?.from ?? "unknown").slice(0, 100);
    const labels = msg?.labelIds ?? [];

    const payload = JSON.stringify({
      message_id: id,
      subject,
      from,
      labels,
    }).replace(/'/g, "''");

    runPsql(
      `INSERT INTO cortana_event_stream (source, event_type, payload) VALUES ('email', 'new_unread', '${payload}'::jsonb);`,
      { env, args: ["-q"], stdio: "ignore" }
    );
  }

  fs.writeFileSync(lastFile, `${currentIds.join("\n")}\n`, "utf8");
}

main();
