#!/usr/bin/env npx tsx

import fs from "fs";
import path from "path";

type CheckResult = {
  name: string;
  passed: boolean;
  score: number;
  detail: string;
  hard_stop?: boolean;
};

type Json = Record<string, any>;

function formatInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const grab = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const year = grab("year");
  const month = grab("month");
  const day = grab("day");
  const hour = grab("hour");
  const minute = grab("minute");
  const second = grab("second");

  const localIso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const tzDate = new Date(`${localIso}Z`);
  const offsetMinutes = Math.round((tzDate.getTime() - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offH = String(Math.floor(abs / 60)).padStart(2, "0");
  const offM = String(abs % 60).padStart(2, "0");
  return `${localIso}${sign}${offH}:${offM}`;
}

async function httpJson(url: string, timeoutSeconds = 7): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "trade-guardrails/2.0" },
      signal: controller.signal,
    });
    const body = await res.text();
    return JSON.parse(body);
  } finally {
    clearTimeout(timeout);
  }
}

function loadJsonBlob(raw?: string | null, filePath?: string | null, fallback: Json | null = null): Json {
  if (raw) return JSON.parse(raw);
  if (filePath) {
    const content = fs.readFileSync(path.resolve(filePath), "utf8");
    return JSON.parse(content);
  }
  return fallback ?? {};
}

async function whoopReadiness(): Promise<number> {
  const urls = [
    "http://localhost:3033/whoop/recovery",
    "http://localhost:3033/whoop/latest",
    "http://localhost:3033",
  ];
  for (const u of urls) {
    try {
      const js = await httpJson(u, 7);
      if (js && typeof js === "object") {
        for (const k of ["recovery", "recovery_score", "score", "whoop_recovery"]) {
          if (k in js) {
            const val = Number(js[k]);
            if (!Number.isNaN(val)) return val <= 1 ? val * 100 : val;
          }
        }
        const latest = js.latest;
        if (latest && typeof latest === "object") {
          for (const k of ["recovery", "recovery_score", "score"]) {
            if (k in latest) {
              const val = Number(latest[k]);
              if (!Number.isNaN(val)) return val <= 1 ? val * 100 : val;
            }
          }
        }
      }
    } catch {
      continue;
    }
  }
  return 55.0;
}

async function portfolioData(): Promise<Json> {
  try {
    const js = await httpJson("http://localhost:3033/alpaca/portfolio", 7);
    return js && typeof js === "object" ? js : {};
  } catch {
    return {};
  }
}

function positionConcentration(portfolio: Json, symbol: string, proposedNotional: number): [number, number, boolean] {
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  let equity = Number(portfolio.equity ?? portfolio.portfolio_value ?? portfolio.net_liquidation ?? 0);
  if (!equity || equity <= 0) {
    const mv = positions.map((p) => Math.abs(Number(p?.market_value ?? 0)));
    equity = mv.length ? mv.reduce((a, b) => a + b, 0) : 0;
  }

  if (!equity || equity <= 0) return [0, 0, false];

  let current = 0;
  let maxExisting = 0;
  for (const p of positions) {
    const mv = Math.abs(Number(p?.market_value ?? 0));
    maxExisting = Math.max(maxExisting, mv / equity);
    if (String(p?.symbol ?? "").toUpperCase() === symbol.toUpperCase()) {
      current = mv;
    }
  }

  const postWeight = (current + proposedNotional) / equity;
  return [maxExisting, postWeight, true];
}

function riskRewardCheck(setup: Json): CheckResult {
  const entry = Number(setup.entry ?? 0);
  const stop = Number(setup.stop ?? 0);
  const target = Number(setup.target ?? 0);
  if (!entry || !stop || !target) {
    return { name: "risk_reward", passed: false, score: 0, detail: "Missing entry/stop/target", hard_stop: true };
  }
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk <= 0) {
    return { name: "risk_reward", passed: false, score: 0, detail: "Invalid stop distance", hard_stop: true };
  }
  const rr = reward / risk;
  return {
    name: "risk_reward",
    passed: rr >= 2.0,
    score: Math.min(rr / 3.0, 1.0),
    detail: `R/R=${rr.toFixed(2)} (${rr >= 2 ? "meets" : "below"} 2.0 threshold)`,
    hard_stop: rr < 1.5,
  };
}

function canslimCheck(setup: Json): CheckResult {
  let score = 0;
  if ("canslim_score" in setup) {
    score = Number(setup.canslim_score ?? 0);
  } else {
    const keys = [
      "current_quarter_eps",
      "annual_eps_growth",
      "new_high",
      "supply_demand",
      "leader",
      "institutional",
      "market_uptrend",
    ];
    const flags = keys.map((k) => (setup[k] ? 1 : 0));
    score = flags.length ? (100 * flags.reduce((a, b) => a + b, 0)) / flags.length : 0;
  }
  const passed = score >= 70;
  return {
    name: "canslim_quality",
    passed,
    score: score / 100,
    detail: `CANSLIM quality ${score.toFixed(0)}/100`,
    hard_stop: score < 50,
  };
}

function regimeFitCheck(setup: Json): CheckResult {
  const regime = String(setup.market_regime ?? "unknown").toLowerCase();
  const style = String(setup.setup_style ?? "breakout").toLowerCase();
  let ok = true;
  if (["risk_off", "bear", "high_vol"].includes(regime) && ["breakout", "momentum"].includes(style)) {
    ok = false;
  }
  const score = ok ? 0.8 : 0.2;
  return { name: "market_regime_fit", passed: ok, score, detail: `Regime=${regime}, style=${style}` };
}

function chasingCheck(setup: Json): CheckResult {
  const entry = Number(setup.entry ?? 0);
  const pivot = Number(setup.pivot ?? entry);
  const ext = pivot > 0 ? ((entry - pivot) / pivot) * 100 : 0;
  const passed = ext <= 3.0;
  return {
    name: "no_chasing",
    passed,
    score: passed ? 1.0 : Math.max(0, 1.0 - (ext - 3) / 5),
    detail: `Entry is ${ext.toFixed(2)}% above pivot`,
    hard_stop: ext > 5.0,
  };
}

function readinessCheck(recovery: number): CheckResult {
  const passed = recovery >= 45;
  return {
    name: "readiness_window",
    passed,
    score: Math.min(recovery / 100, 1.0),
    detail: `Whoop recovery=${recovery.toFixed(0)}`,
    hard_stop: recovery < 35,
  };
}

function concentrationCheck(
  maxExisting: number,
  postWeight: number,
  cap: number,
  known: boolean
): CheckResult {
  if (!known) {
    return {
      name: "concentration_cap",
      passed: true,
      score: 0.5,
      detail: "Portfolio equity unavailable; concentration check downgraded.",
      hard_stop: false,
    };
  }
  const passed = postWeight <= cap;
  const detail = `Post-trade weight=${(postWeight * 100).toFixed(1)}%, cap=${(
    cap * 100
  ).toFixed(1)}%, current max holding=${(maxExisting * 100).toFixed(1)}%`;
  return {
    name: "concentration_cap",
    passed,
    score: Math.max(0, 1.0 - Math.max(0, postWeight - cap) * 8),
    detail,
    hard_stop: postWeight > cap + 0.05,
  };
}

type Args = {
  setupJson?: string | null;
  setupFile?: string | null;
  symbol: string;
  notional: number;
  concentrationCap: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    setupJson: null,
    setupFile: null,
    symbol: "",
    notional: 0,
    concentrationCap: 0.25,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--setup-json":
        args.setupJson = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--setup-file":
        args.setupFile = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--symbol":
        args.symbol = argv[i + 1] ?? "";
        i += 1;
        break;
      case "--notional":
        args.notional = Number(argv[i + 1]);
        i += 1;
        break;
      case "--concentration-cap":
        args.concentrationCap = Number(argv[i + 1]);
        i += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const setup = loadJsonBlob(args.setupJson, args.setupFile, {});
  const symbol = String(setup.symbol ?? args.symbol ?? "").toUpperCase();
  const notional = Number(setup.notional ?? args.notional ?? 0);

  const portfolio = await portfolioData();
  const recovery = await whoopReadiness();
  const [maxExisting, postWeight, concentrationKnown] = positionConcentration(portfolio, symbol, notional);

  const checks: CheckResult[] = [
    canslimCheck(setup),
    regimeFitCheck(setup),
    riskRewardCheck(setup),
    chasingCheck(setup),
    readinessCheck(recovery),
    concentrationCheck(maxExisting, postWeight, args.concentrationCap, concentrationKnown),
  ];

  const hardStops = checks.filter((c) => c.hard_stop && !c.passed);
  const passed = checks.every((c) => c.passed) && hardStops.length === 0;
  const quality = checks.length
    ? Math.round((checks.reduce((sum, c) => sum + c.score, 0) / checks.length) * 1000) / 1000
    : 0.0;

  const verdict = {
    generated_at: formatInTimeZone(new Date(), "America/New_York"),
    symbol,
    proposed_notional: notional,
    verdict: passed ? "PASS" : "FAIL",
    quality_score: quality,
    rationale: checks.filter((c) => !c.passed).map((c) => c.detail).slice(0, 4).length
      ? checks.filter((c) => !c.passed).map((c) => c.detail).slice(0, 4)
      : ["All guardrails satisfied."],
    hard_stops: hardStops.map((c) => c.name),
    checks,
    context: {
      whoop_recovery: recovery,
      portfolio_concentration_post_trade: postWeight,
      concentration_cap: args.concentrationCap,
    },
  };

  console.log(JSON.stringify(verdict, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
