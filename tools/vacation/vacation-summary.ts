import fs from "node:fs";
import path from "node:path";
import { sourceRepoRoot } from "../lib/paths.js";
import { getActiveVacationWindow, getLatestReadinessRun, listVacationIncidents } from "./vacation-state.js";
import type {
  VacationIncidentRow,
  VacationReadinessOutcome,
  VacationSummaryPayload,
  VacationSummaryPeriod,
  VacationSummaryStatus,
  VacationWindowRow,
} from "./types.js";

type CronJobConfig = {
  id?: string;
  name?: string;
};

function readCronJobNameMap(): Map<string, string> {
  try {
    const raw = fs.readFileSync(path.join(sourceRepoRoot(), "config", "cron", "jobs.json"), "utf8");
    const parsed = JSON.parse(raw) as { jobs?: CronJobConfig[] };
    return new Map(
      (parsed.jobs ?? [])
        .map((job) => [String(job.id ?? ""), String(job.name ?? "").trim()] as const)
        .filter(([id, name]) => Boolean(id) && Boolean(name)),
    );
  } catch {
    return new Map();
  }
}

function resolvePausedJobs(window: VacationWindowRow): Array<{ id: string; name: string | null }> {
  const pausedJobIds = Array.isArray(window.state_snapshot?.paused_job_ids)
    ? window.state_snapshot.paused_job_ids.map((value: unknown) => String(value))
    : [];
  const nameMap = readCronJobNameMap();
  return pausedJobIds.map((id) => ({
    id,
    name: nameMap.get(id) ?? null,
  }));
}

function summaryStatus(incidents: VacationIncidentRow[], readinessOutcome: VacationReadinessOutcome | null): VacationSummaryStatus {
  if (incidents.some((incident) => incident.human_required || incident.tier <= 1)) return "red";
  if (incidents.length > 0 || readinessOutcome === "warn") return "yellow";
  return "green";
}

export function buildVacationSummaryPayload(params: {
  window: VacationWindowRow;
  period: VacationSummaryPeriod;
  incidents: VacationIncidentRow[];
  readinessOutcome: VacationReadinessOutcome | null;
  latestReadinessRunId: number | null;
}): VacationSummaryPayload {
  const activeIncidents = params.incidents.filter((incident) => incident.status !== "resolved");
  const resolvedIncidents = params.incidents.filter((incident) => incident.status === "resolved");
  const pausedJobs = resolvePausedJobs(params.window);
  const pausedJobIds = pausedJobs.map((job) => job.id);
  const degradedSystems = activeIncidents.map((incident) => incident.system_key);
  const overall = summaryStatus(activeIncidents, params.readinessOutcome);
  return {
    window_id: params.window.id,
    period: params.period,
    overall_status: overall,
    readiness_outcome: params.readinessOutcome,
    active_incident_count: activeIncidents.length,
    resolved_incident_count: resolvedIncidents.length,
    human_required_count: activeIncidents.filter((incident) => incident.human_required).length,
    paused_job_ids: pausedJobIds,
    last_transition_at: params.window.disabled_at ?? params.window.enabled_at ?? params.window.updated_at,
    latest_readiness_run_id: params.latestReadinessRunId,
    active_systems: activeIncidents.map((incident) => incident.system_key),
    degraded_systems: degradedSystems,
    self_heal_count: resolvedIncidents.filter((incident) => incident.resolution_reason === "remediated").length,
    degradation_summary: degradedSystems.length ? degradedSystems.slice(0, 3).join(", ") : "none",
    paused_jobs: pausedJobs,
  };
}

export function renderVacationSummaryText(payload: VacationSummaryPayload): string {
  const outcome = payload.readiness_outcome ? payload.readiness_outcome.toUpperCase().replace("_", "-") : "N/A";
  const header = `🏖️ Vacation Ops ${payload.period === "morning" ? "AM" : "PM"} | ${payload.overall_status.toUpperCase()}`;
  const line2 = `Readiness ${outcome}. Active ${payload.active_incident_count}, resolved ${payload.resolved_incident_count}, human ${payload.human_required_count}, self-heals ${payload.self_heal_count}.`;
  const pausedJobNames = Array.isArray((payload as VacationSummaryPayload & { paused_jobs?: Array<{ id: string; name: string | null }> }).paused_jobs)
    ? ((payload as VacationSummaryPayload & { paused_jobs?: Array<{ id: string; name: string | null }> }).paused_jobs ?? [])
        .map((job) => job.name || job.id)
        .filter(Boolean)
    : [];
  const line3 = pausedJobNames.length
    ? `Paused jobs: ${pausedJobNames.join(", ")}.`
    : "Paused jobs: none.";
  const line4 = `Degradations: ${payload.degradation_summary}.`;
  return [header, line2, line3, line4].join("\n");
}

export function summarizeActiveVacation(period: VacationSummaryPeriod): { payload: VacationSummaryPayload; text: string } | null {
  const window = getActiveVacationWindow();
  if (!window) return null;
  const incidents = listVacationIncidents(window.id);
  const latestReadiness = getLatestReadinessRun(window.id);
  const payload = buildVacationSummaryPayload({
    window,
    period,
    incidents,
    readinessOutcome: latestReadiness?.readiness_outcome ?? null,
    latestReadinessRunId: latestReadiness?.id ?? null,
  });
  return { payload, text: renderVacationSummaryText(payload) };
}
