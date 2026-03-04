#!/usr/bin/env npx tsx
import path from "path";
import { spawnSync } from "child_process";
import fs from "fs";

function usage(): void {
  const script = path.basename(process.argv[1] ?? "log-heartbeat-decision.ts");
  process.stderr.write(
    `Usage: ${script} <check_name> <outcome> <reasoning> <confidence> [data_inputs_json]\n`
  );
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeOutcome(raw: string): "success" | "skipped" | "fail" {
  const v = normalize(raw);
  if (["success", "ok", "pass", "passed", "healthy", "info"].includes(v)) return "success";
  if (["skip", "skipped", "noop", "no_op", "n_a", "na"].includes(v)) return "skipped";
  if (["fail", "failed", "failure", "error", "warning", "warn", "critical"].includes(v)) return "fail";
  return "skipped";
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length < 4) {
    usage();
    return 1;
  }

  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const logDecisionScript = path.join(scriptDir, "log-decision.ts");

  const checkNameRaw = argv[0] ?? "";
  const outcome = argv[1] ?? "";
  const reasoning = argv[2] ?? "";
  const confidence = argv[3] ?? "";
  const dataInputsJson = argv[4] ?? "{}";

  if (!fs.existsSync(logDecisionScript)) {
    process.stderr.write(
      `Error: log-decision.ts not found or not executable at ${logDecisionScript}\n`
    );
    return 1;
  }

  if (!isExecutable(logDecisionScript)) {
    process.stderr.write(
      `Error: log-decision.ts not found or not executable at ${logDecisionScript}\n`
    );
    return 1;
  }

  const normalizedOutcome = normalizeOutcome(outcome);
  const checkName = normalize(checkNameRaw);

  const taxonomy: Record<string, { actionType: string; actionName: string }> = {
    email: { actionType: "email_triage", actionName: "heartbeat_email_triage" },
    email_triage: { actionType: "email_triage", actionName: "heartbeat_email_triage" },
    feedback_triage: { actionType: "email_triage", actionName: "heartbeat_email_triage" },
    feedback_pipeline: { actionType: "email_triage", actionName: "heartbeat_email_triage" },

    calendar: { actionType: "calendar_check", actionName: "heartbeat_calendar_lookahead" },
    calendar_check: { actionType: "calendar_check", actionName: "heartbeat_calendar_lookahead" },
    calendar_lookahead: { actionType: "calendar_check", actionName: "heartbeat_calendar_lookahead" },

    portfolio: { actionType: "portfolio_check", actionName: "heartbeat_portfolio_alerts" },
    portfolio_check: { actionType: "portfolio_check", actionName: "heartbeat_portfolio_alerts" },
    portfolio_alerts: { actionType: "portfolio_check", actionName: "heartbeat_portfolio_alerts" },

    fitness: { actionType: "fitness_check", actionName: "heartbeat_fitness_checkin" },
    fitness_check: { actionType: "fitness_check", actionName: "heartbeat_fitness_checkin" },
    fitness_checkin: { actionType: "fitness_check", actionName: "heartbeat_fitness_checkin" },

    weather: { actionType: "weather_check", actionName: "heartbeat_weather" },
    weather_check: { actionType: "weather_check", actionName: "heartbeat_weather" },

    budget: { actionType: "budget_check", actionName: "heartbeat_api_budget_check" },
    budget_check: { actionType: "budget_check", actionName: "heartbeat_api_budget_check" },
    api_budget: { actionType: "budget_check", actionName: "heartbeat_api_budget_check" },
    api_budget_check: { actionType: "budget_check", actionName: "heartbeat_api_budget_check" },

    tech_news: { actionType: "tech_news", actionName: "heartbeat_tech_news" },
    news: { actionType: "tech_news", actionName: "heartbeat_tech_news" },
    tech: { actionType: "tech_news", actionName: "heartbeat_tech_news" },

    mission: { actionType: "mission_task", actionName: "heartbeat_mission_advancement" },
    mission_task: { actionType: "mission_task", actionName: "heartbeat_mission_advancement" },
    mission_advancement: { actionType: "mission_task", actionName: "heartbeat_mission_advancement" },

    task_execution: { actionType: "task_execution", actionName: "heartbeat_task_queue_execution" },
    task_queue_execution: { actionType: "task_execution", actionName: "heartbeat_task_queue_execution" },
    task_queue: { actionType: "task_execution", actionName: "heartbeat_task_queue_execution" },
    task_board: { actionType: "task_execution", actionName: "heartbeat_task_queue_execution" },

    system_health: { actionType: "system_health", actionName: "heartbeat_system_health" },
    health: { actionType: "system_health", actionName: "heartbeat_system_health" },
    proactive_intelligence: { actionType: "system_health", actionName: "heartbeat_system_health" },
    watchlist: { actionType: "system_health", actionName: "heartbeat_system_health" },
    heartbeat_state: { actionType: "system_health", actionName: "heartbeat_system_health" },
    cron_delivery: { actionType: "system_health", actionName: "heartbeat_system_health" },
    cron_auto_retry: { actionType: "system_health", actionName: "heartbeat_system_health" },
    commitments: { actionType: "system_health", actionName: "heartbeat_system_health" },
    subagent_reaper: { actionType: "system_health", actionName: "heartbeat_system_health" },
  };

  const mapped = taxonomy[checkName];
  if (!mapped) {
    process.stderr.write(`Error: unsupported check_name '${checkNameRaw}'\n`);
    process.stderr.write("Supported via taxonomy map; add new aliases in tools/log-heartbeat-decision.ts\n");
    return 1;
  }

  const res = spawnSync(
    logDecisionScript,
    [
      "heartbeat",
      mapped.actionType,
      mapped.actionName,
      normalizedOutcome,
      reasoning,
      confidence,
      "",
      "",
      dataInputsJson,
    ],
    { stdio: "inherit" }
  );

  return res.status ?? 1;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
