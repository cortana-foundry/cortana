#!/usr/bin/env npx tsx
import fs from "node:fs";
import path from "node:path";

interface Workaround {
  name: string;
  path: string;
}
interface Issue {
  key: string;
  title: string;
  url: string;
  local_workarounds: Workaround[];
}
interface Watchlist {
  repo: string;
  last_reviewed_at: string;
  issues: Issue[];
}

const root = "/Users/hd/openclaw";
const watchlistPath = path.join(root, "config/upstream-reliability-watchlist.json");

function main() {
  const raw = fs.readFileSync(watchlistPath, "utf8");
  const watchlist = JSON.parse(raw) as Watchlist;

  const rows = watchlist.issues.flatMap((issue) =>
    issue.local_workarounds.map((w) => {
      const absolute = path.join(root, w.path);
      const exists = fs.existsSync(absolute);
      return {
        issue_key: issue.key,
        issue_title: issue.title,
        issue_url: issue.url,
        workaround: w.name,
        workaround_path: w.path,
        file_exists: exists,
      };
    }),
  );

  const missing = rows.filter((r) => !r.file_exists);
  const summary = {
    repo: watchlist.repo,
    last_reviewed_at: watchlist.last_reviewed_at,
    issue_count: watchlist.issues.length,
    workaround_count: rows.length,
    missing_count: missing.length,
    rows,
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Upstream reliability tracker (${summary.repo})`);
    console.log(`Last reviewed: ${summary.last_reviewed_at}`);
    console.log(`Issues: ${summary.issue_count} | Workarounds: ${summary.workaround_count} | Missing paths: ${summary.missing_count}`);
    for (const r of rows) {
      console.log(`- [${r.file_exists ? "OK" : "MISSING"}] ${r.issue_key} :: ${r.workaround} (${r.workaround_path})`);
    }
  }

  if (missing.length > 0) process.exit(2);
}

main();
