#!/usr/bin/env npx tsx

import fs from "fs";
import lancedb from "lancedb";

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  return argv[i + 1];
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help")) {
    console.log("usage: decay-scorer.ts --query <text> [--top-k N] [--candidate-k N]");
    return 0;
  }

  const query = arg("--query", argv);
  if (!query) {
    console.error("--query is required");
    return 2;
  }

  const topK = Number(arg("--top-k", argv) ?? "5");
  const candidateK = Number(arg("--candidate-k", argv) ?? String(Math.max(topK * 2, 10)));

  const cfgRaw = fs.readFileSync("/Users/hd/openclaw/config/openmemory.json", "utf8");
  const cfg = JSON.parse(cfgRaw || "{}");
  const apiKey = cfg?.plugins?.entries?.["memory-lancedb"]?.config?.embedding?.apiKey;

  const embRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey ?? ""}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
  });
  if (!embRes.ok) throw new Error("embedding request failed");
  const embJson: any = await embRes.json();
  const embedding = embJson?.data?.[0]?.embedding;

  const db = await lancedb.connect("/Users/hd/openclaw/.memory/lancedb");
  const table = await db.openTable("memory");
  const rows: any[] = await table.vectorSearch(embedding).limit(candidateK).toArray();

  const now = Date.now();
  const scored = rows.map((r) => {
    const ageDays = Math.max(0, (now - Number(r.createdAt ?? now)) / 86400000);
    const decay = Math.exp(-ageDays / 180);
    const similarity = 1 - Number(r._distance ?? 1);
    const score = similarity * 0.85 + decay * 0.15;
    return { ...r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  console.log(JSON.stringify({ results: scored.slice(0, topK) }));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
}
