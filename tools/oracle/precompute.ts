#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../lib/paths.js";
import { readJsonFile, writeJsonFileAtomic } from "../lib/json-file.js";

const ROOT = repoRoot();
const CACHE_PATH = path.join(ROOT, "tmp", "oracle-cache.json");
const LOG_PATH = path.join(ROOT, "tmp", "oracle-precompute.log");

const DEFAULT_TTLS: Record<string, number> = {
  weather: 3 * 60 * 60,
  calendar: 90 * 60,
  portfolio: 45 * 60,
  recovery: 90 * 60,
  email: 30 * 60,
};

type SourceResult = {
  source: string;
  ok: boolean;
  fetched_at: string;
  expires_at: string;
  ttl_seconds: number;
  data?: any;
  error?: string | null;
};

function nowUtc(): Date {
  return new Date();
}

function iso(dt: Date): string {
  return dt.toISOString();
}

function runCmd(cmd: string[], timeout = 20): string {
  const env = { ...process.env };
  env.PATH = "/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/local/bin:/usr/bin:/bin";
  const proc = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", timeout: timeout * 1000, env });
  if (proc.status !== 0) {
    const err = (proc.stderr || proc.stdout || "command failed").toString().trim();
    throw new Error(err);
  }
  return (proc.stdout || "").toString().trim();
}

async function readJsonUrl(url: string, timeout = 10, headers?: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);
  try {
    const res = await fetch(url, { headers: headers ?? { "User-Agent": "oracle-precompute/1.0" }, signal: controller.signal });
    const text = await res.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWeather(): Promise<any> {
  try {
    const wttr = runCmd(["curl", "-fsSL", "https://wttr.in/Warren,NJ?format=j1"], 12);
    return { provider: "wttr.in", payload: JSON.parse(wttr) };
  } catch {
    const omUrl =
      "https://api.open-meteo.com/v1/forecast" +
      "?latitude=40.63&longitude=-74.49" +
      "&current_weather=true" +
      "&temperature_unit=fahrenheit" +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode" +
      "&timezone=America/New_York&forecast_days=2";
    const payload = await readJsonUrl(omUrl, 12);
    return { provider: "open-meteo", payload };
  }
}

function fetchCalendar(): any {
  const raw = runCmd(["gog", "cal", "list", "--days", "1", "--plain"], 20);
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { provider: "gog", events: lines, count: lines.length };
}

async function fetchPortfolio(): Promise<any> {
  const key = process.env.ALPACA_API_KEY ?? process.env.APCA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET ?? process.env.APCA_API_SECRET_KEY;
  const base = process.env.ALPACA_BASE_URL ?? "https://paper-api.alpaca.markets";

  if (key && secret) {
    const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret };
    const acct = await readJsonUrl(`${base.replace(/\/$/, "")}/v2/account`, 10, headers);
    const positions = await readJsonUrl(`${base.replace(/\/$/, "")}/v2/positions`, 12, headers);
    return {
      provider: "alpaca",
      equity: acct?.equity,
      cash: acct?.cash,
      buying_power: acct?.buying_power,
      positions_count: Array.isArray(positions) ? positions.length : 0,
      top_positions: Array.isArray(positions) ? positions.slice(0, 10) : [],
    };
  }

  const mem = runCmd(
    [
      "psql",
      "cortana",
      "-At",
      "-c",
      "SELECT metadata::text FROM cortana_tasks WHERE title ILIKE '%portfolio%' ORDER BY created_at DESC LIMIT 1;",
    ],
    8,
  );
  return {
    provider: "fallback",
    note: "Alpaca credentials not available in environment during precompute run.",
    latest_task_metadata: mem || null,
  };
}

async function fetchRecovery(): Promise<any> {
  const endpoints = [
    "http://localhost:3033/whoop/recovery/latest",
    "http://localhost:3033/fitness/recovery",
    "http://localhost:3033/tonal/recovery",
    "http://localhost:3033/tonal/health",
  ];
  const errors: string[] = [];
  for (const ep of endpoints) {
    try {
      const out = runCmd(["curl", "-fsSL", "--max-time", "8", ep], 10);
      let payload: any;
      try {
        payload = JSON.parse(out);
      } catch {
        payload = { raw: out };
      }
      return { provider: "local-fitness-service", endpoint: ep, payload };
    } catch (err) {
      errors.push(`${ep}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    provider: "fallback",
    note: "No local fitness endpoint responded during precompute.",
    attempts: errors,
  };
}

function normalizeGogPayload(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const key of ["messages", "results", "items", "threads"]) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  return [];
}

async function fetchEmail(): Promise<any> {
  const queries = [
    "is:unread newer_than:3d -category:promotions -category:social",
    "is:unread newer_than:1d",
  ];

  let lastError: string | null = null;
  for (const q of queries) {
    const commands = [
      ["gog", "gmail", "search", "--query", q, "--max", "15", "--json"],
      ["gog", "gmail", "search", q, "--max", "15", "--json"],
    ];
    for (const cmd of commands) {
      try {
        const raw = runCmd(cmd, 20);
        const payload = raw ? JSON.parse(raw) : [];
        const items = normalizeGogPayload(payload);
        const highlights = items.slice(0, 10).map((item: any) => ({
          id: item?.id ?? item?.messageId,
          threadId: item?.threadId ?? item?.thread_id,
          from: item?.from ?? item?.sender,
          subject: item?.subject,
          date: item?.date ?? item?.timestamp,
          snippet: item?.snippet ?? item?.preview,
        }));
        return { provider: "gog", query: q, count: highlights.length, highlights };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  throw new Error(lastError || "failed to fetch email highlights");
}

async function collect(): Promise<Record<string, any>> {
  const handlers: Record<string, () => Promise<any> | any> = {
    weather: fetchWeather,
    calendar: fetchCalendar,
    portfolio: fetchPortfolio,
    recovery: fetchRecovery,
    email: fetchEmail,
  };

  const results: Record<string, SourceResult> = {};
  const t0 = nowUtc();
  for (const [name, fn] of Object.entries(handlers)) {
    const ttl = DEFAULT_TTLS[name];
    const fetchedAt = nowUtc();
    const expiresAt = new Date(fetchedAt.getTime() + ttl * 1000);
    try {
      const data = await fn();
      results[name] = {
        source: name,
        ok: true,
        fetched_at: iso(fetchedAt),
        expires_at: iso(expiresAt),
        ttl_seconds: ttl,
        data,
        error: null,
      };
    } catch (err) {
      results[name] = {
        source: name,
        ok: false,
        fetched_at: iso(fetchedAt),
        expires_at: iso(expiresAt),
        ttl_seconds: ttl,
        data: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const minExpiry = new Date(
    Math.min(...Object.values(results).map((r) => new Date(r.expires_at).getTime())),
  );

  return {
    generated_at: iso(t0),
    expires_at: iso(minExpiry),
    ttl_seconds: Math.floor((minExpiry.getTime() - t0.getTime()) / 1000),
    sources: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ...v }])),
  };
}

function summaryOk(payload: Record<string, any>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const sources = payload.sources ?? {};
  for (const [name, src] of Object.entries(sources)) {
    out[name] = Boolean((src as any).ok);
  }
  return out;
}

function cacheWrite(payload: Record<string, any>): void {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  writeJsonFileAtomic(CACHE_PATH, payload, 2);
  const line = `[${new Date().toISOString()}] precompute run ok=${JSON.stringify(summaryOk(payload))}\n`;
  fs.appendFileSync(LOG_PATH, line, "utf8");
}

function cacheRead(): Record<string, any> {
  if (!fs.existsSync(CACHE_PATH)) throw new Error(`cache not found: ${CACHE_PATH}`);
  const data = readJsonFile<Record<string, any>>(CACHE_PATH);
  if (!data) throw new Error(`cache not found: ${CACHE_PATH}`);
  return data;
}

function isStale(entry: Record<string, any>): boolean {
  const exp = entry.expires_at;
  if (!exp) return true;
  return new Date(exp).getTime() < nowUtc().getTime();
}

async function cmdRun(): Promise<number> {
  const payload = await collect();
  cacheWrite(payload);
  console.log(JSON.stringify({ cache: CACHE_PATH, ok: summaryOk(payload) }, null, 2));
  return 0;
}

function cmdRead(section: string | null, allowStale: boolean): number {
  const cache = cacheRead();
  if (section) {
    const src = cache.sources?.[section];
    if (!src) throw new Error(`unknown section: ${section}`);
    if (isStale(src) && !allowStale) throw new Error(`section '${section}' is stale (pass --allow-stale)`);
    console.log(JSON.stringify(src, null, 2));
    return 0;
  }

  if (isStale(cache) && !allowStale) throw new Error("oracle cache is stale (pass --allow-stale)");
  console.log(JSON.stringify(cache, null, 2));
  return 0;
}

function cmdStatus(): number {
  if (!fs.existsSync(CACHE_PATH)) {
    console.log(JSON.stringify({ exists: false, cache: CACHE_PATH }, null, 2));
    return 1;
  }

  const cache = cacheRead();
  const status = {
    exists: true,
    generated_at: cache.generated_at,
    expires_at: cache.expires_at,
    stale: isStale(cache),
    sources: Object.fromEntries(
      Object.entries(cache.sources ?? {}).map(([name, src]) => [
        name,
        {
          ok: Boolean((src as any).ok),
          stale: isStale(src as any),
          expires_at: (src as any).expires_at,
        },
      ]),
    ),
  };
  console.log(JSON.stringify(status, null, 2));
  return 0;
}

function parseArgs(argv: string[]) {
  const cmd = argv[0];
  if (!cmd) throw new Error("command required: run|read|status");

  if (cmd === "run") return { cmd, section: null, allowStale: false };

  if (cmd === "read") {
    let section: string | null = null;
    let allowStale = false;
    for (let i = 1; i < argv.length; i += 1) {
      const a = argv[i];
      if (!a.startsWith("--") && !section) {
        section = a;
      } else if (a === "--allow-stale") {
        allowStale = true;
      }
    }
    return { cmd, section, allowStale };
  }

  if (cmd === "status") return { cmd, section: null, allowStale: false };

  throw new Error(`unknown command: ${cmd}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === "run") return cmdRun();
  if (args.cmd === "read") return cmdRead(args.section, args.allowStale);
  return cmdStatus();
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
