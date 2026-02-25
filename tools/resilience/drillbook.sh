#!/usr/bin/env bash
set -euo pipefail

# Resilience Drillbook: 15-Minute Full Recovery SLO
# Usage:
#   ./drillbook.sh inventory
#   ./drillbook.sh recover
#   ./drillbook.sh drill --simulate-failure all
#   ./drillbook.sh drill --simulate-failure gateway --live-failure

export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

DB="cortana"
SLO_SECONDS=900
START_TS=$(date +%s)
MODE="${1:-inventory}"
SIM_FAIL_TARGET="all"
LIVE_FAILURE=0

SERVICE_ORDER=(postgres event_bus gateway fitness watchdog crons)

usage() {
  cat <<'EOF'
Resilience Drillbook

Commands:
  inventory                      Print status of all critical services
  recover                        Health-check + auto-restart failed services in dependency order
  drill [options]                Simulate failures, run recover, time RTO

Drill options:
  --simulate-failure <target>    one of: postgres|event_bus|gateway|fitness|watchdog|crons|all
  --live-failure                 actually stop selected services before recovery (destructive)

Examples:
  ./drillbook.sh recover
  ./drillbook.sh drill --simulate-failure all
  ./drillbook.sh drill --simulate-failure fitness --live-failure
EOF
}

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//"/\\"}
  s=${s//$'\n'/\\n}
  printf '%s' "$s"
}

log_event() {
  local severity="$1"
  local message="$2"
  local metadata="${3:-{}}"
  local esc_msg esc_meta
  esc_msg=$(json_escape "$message")
  esc_meta=$(json_escape "$metadata")

  psql "$DB" -v ON_ERROR_STOP=0 -q -c "
    INSERT INTO cortana_events (event_type, source, severity, message, metadata)
    VALUES ('resilience_drillbook', 'tools/resilience/drillbook.sh', '${severity}', '${esc_msg}', '${esc_meta}'::jsonb);
  " >/dev/null 2>&1 || true
}

elapsed_seconds() {
  echo $(( $(date +%s) - START_TS ))
}

status_line() {
  local svc="$1" ok="$2" details="$3"
  if [[ "$ok" -eq 0 ]]; then
    printf "✅ %-10s %s\n" "$svc" "$details"
  else
    printf "❌ %-10s %s\n" "$svc" "$details"
  fi
}

check_postgres() {
  pg_isready -q -d "$DB" && psql "$DB" -q -t -A -c "SELECT 1" >/dev/null 2>&1
}

check_event_bus() {
  psql "$DB" -q -t -A -c "
    SELECT CASE
      WHEN to_regclass('public.cortana_event_bus_events') IS NULL THEN 'missing_table'
      WHEN EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid
        WHERE c.relname='cortana_events'
          AND t.tgname='cortana_events_event_bus_bridge'
          AND NOT t.tgisinternal
      ) THEN 'ok'
      ELSE 'missing_trigger'
    END;
  " | tr -d '[:space:]' | grep -q '^ok$'
}

check_gateway() {
  openclaw gateway status >/dev/null 2>&1
}

check_fitness() {
  # Fitness service exposes endpoint-specific health checks.
  curl -sSf --max-time 8 http://localhost:3033/health >/dev/null 2>&1 \
    || curl -sSf --max-time 8 http://localhost:3033/tonal/health >/dev/null 2>&1 \
    || curl -sSf --max-time 8 http://localhost:3033/whoop/data >/dev/null 2>&1
}

check_watchdog() {
  launchctl print "gui/$(id -u)/com.cortana.watchdog" >/dev/null 2>&1
}

check_crons() {
  local out
  out=$(openclaw cron list 2>/dev/null || true)
  [[ -n "$out" ]] && echo "$out" | grep -q 'ID\s\+Name\s\+Schedule'
}

restart_postgres() {
  brew services restart postgresql@17 >/dev/null 2>&1
}

restart_event_bus() {
  # Event bus is DB-trigger-based in this stack; repair bridge trigger if needed.
  psql "$DB" -v ON_ERROR_STOP=1 -q -c "
    DO \$\$
    BEGIN
      IF to_regclass('public.cortana_event_bus_events') IS NOT NULL
         AND to_regclass('public.cortana_events') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trg_cortana_events_to_event_bus')
      THEN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid=t.tgrelid
          WHERE c.relname='cortana_events'
            AND t.tgname='cortana_events_event_bus_bridge'
            AND NOT t.tgisinternal
        ) THEN
          CREATE TRIGGER cortana_events_event_bus_bridge
          AFTER INSERT ON cortana_events
          FOR EACH ROW EXECUTE FUNCTION trg_cortana_events_to_event_bus();
        END IF;
      END IF;
    END
    \$\$;
  " >/dev/null 2>&1
}

restart_gateway() {
  openclaw gateway restart >/dev/null 2>&1
}

restart_fitness() {
  launchctl kickstart -k "gui/$(id -u)/com.cortana.fitness-service" >/dev/null 2>&1
}

restart_watchdog() {
  launchctl kickstart -k "gui/$(id -u)/com.cortana.watchdog" >/dev/null 2>&1
}

restart_crons() {
  # No global cron daemon in OpenClaw; restart gateway to rehydrate scheduler state.
  openclaw gateway restart >/dev/null 2>&1
}

check_service() {
  local svc="$1"
  case "$svc" in
    postgres) check_postgres ;;
    event_bus) check_event_bus ;;
    gateway) check_gateway ;;
    fitness) check_fitness ;;
    watchdog) check_watchdog ;;
    crons) check_crons ;;
    *) return 1 ;;
  esac
}

restart_service() {
  local svc="$1"
  case "$svc" in
    postgres) restart_postgres ;;
    event_bus) restart_event_bus ;;
    gateway) restart_gateway ;;
    fitness) restart_fitness ;;
    watchdog) restart_watchdog ;;
    crons) restart_crons ;;
    *) return 1 ;;
  esac
}

print_inventory() {
  echo "Critical service inventory"
  echo "--------------------------"
  echo "1) postgres  : Homebrew service postgresql@17"
  echo "2) event_bus : PostgreSQL table + trigger bridge (cortana_events -> cortana_event_bus_events)"
  echo "3) gateway   : launchd label ai.openclaw.gateway / openclaw gateway"
  echo "4) fitness   : launchd label com.cortana.fitness-service (health: :3033/health)"
  echo "5) watchdog  : launchd label com.cortana.watchdog"
  echo "6) crons     : OpenClaw cron scheduler (openclaw cron list)"
  echo

  for svc in "${SERVICE_ORDER[@]}"; do
    if check_service "$svc"; then
      status_line "$svc" 0 "healthy"
    else
      status_line "$svc" 1 "unhealthy"
    fi
  done
}

recover_services() {
  local recovered=0 failed=0

  log_event "info" "Recovery run started" "{\"mode\":\"recover\",\"slo_seconds\":${SLO_SECONDS}}"
  echo "Recovery run (dependency order): ${SERVICE_ORDER[*]}"

  for svc in "${SERVICE_ORDER[@]}"; do
    if check_service "$svc"; then
      status_line "$svc" 0 "already healthy"
      continue
    fi

    log_event "warning" "Service unhealthy, restarting" "{\"service\":\"$svc\",\"elapsed_seconds\":$(elapsed_seconds)}"
    echo "↻ Restarting $svc ..."
    if restart_service "$svc"; then
      sleep 3
      if check_service "$svc"; then
        recovered=$((recovered + 1))
        status_line "$svc" 0 "recovered"
        log_event "info" "Service recovered" "{\"service\":\"$svc\",\"elapsed_seconds\":$(elapsed_seconds)}"
      else
        failed=$((failed + 1))
        status_line "$svc" 1 "restart attempted but still unhealthy"
        log_event "error" "Service restart failed validation" "{\"service\":\"$svc\",\"elapsed_seconds\":$(elapsed_seconds)}"
      fi
    else
      failed=$((failed + 1))
      status_line "$svc" 1 "restart command failed"
      log_event "error" "Service restart command failed" "{\"service\":\"$svc\",\"elapsed_seconds\":$(elapsed_seconds)}"
    fi
  done

  local total_elapsed
  total_elapsed=$(elapsed_seconds)
  local slo_met="false"
  if [[ "$total_elapsed" -le "$SLO_SECONDS" && "$failed" -eq 0 ]]; then
    slo_met="true"
  fi

  log_event "info" "Recovery run complete" "{\"elapsed_seconds\":${total_elapsed},\"recovered\":${recovered},\"failed\":${failed},\"slo_met\":${slo_met}}"

  echo
  echo "Recovery summary: recovered=${recovered} failed=${failed} elapsed=${total_elapsed}s SLO(${SLO_SECONDS}s)=${slo_met}"
  [[ "$failed" -eq 0 ]]
}

simulate_failure_soft() {
  local target="$1"
  log_event "warning" "Soft failure simulation" "{\"target\":\"$target\"}"
  echo "🧪 Soft failure simulation target=$target (no service stopped)"
}

simulate_failure_live() {
  local target="$1"
  log_event "warning" "Live failure simulation started" "{\"target\":\"$target\"}"
  echo "🚨 LIVE failure simulation target=$target"

  stop_if_target() {
    local svc="$1"
    [[ "$target" == "all" || "$target" == "$svc" ]]
  }

  if stop_if_target fitness; then
    launchctl bootout "gui/$(id -u)/com.cortana.fitness-service" >/dev/null 2>&1 || true
  fi
  if stop_if_target watchdog; then
    launchctl bootout "gui/$(id -u)/com.cortana.watchdog" >/dev/null 2>&1 || true
  fi
  if stop_if_target gateway || stop_if_target crons; then
    openclaw gateway stop >/dev/null 2>&1 || true
  fi
  if stop_if_target postgres || stop_if_target event_bus; then
    brew services stop postgresql@17 >/dev/null 2>&1 || true
  fi

  sleep 2
}

run_drill() {
  local drill_start
  drill_start=$(date +%s)

  if [[ "$LIVE_FAILURE" -eq 1 ]]; then
    simulate_failure_live "$SIM_FAIL_TARGET"
  else
    simulate_failure_soft "$SIM_FAIL_TARGET"
  fi

  if recover_services; then
    :
  fi

  local rto=$(( $(date +%s) - drill_start ))
  local slo_met="false"
  if [[ "$rto" -le "$SLO_SECONDS" ]]; then
    slo_met="true"
  fi

  log_event "info" "Drill complete" "{\"simulate_failure\":\"$SIM_FAIL_TARGET\",\"live_failure\":$LIVE_FAILURE,\"rto_seconds\":$rto,\"slo_seconds\":$SLO_SECONDS,\"slo_met\":$slo_met}"
  echo "Drill complete: rto=${rto}s slo_met=${slo_met}"
}

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --simulate-failure)
      SIM_FAIL_TARGET="${2:-all}"
      shift 2
      ;;
    --live-failure)
      LIVE_FAILURE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

case "$MODE" in
  inventory)
    print_inventory
    ;;
  recover)
    recover_services
    ;;
  drill)
    run_drill
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $MODE" >&2
    usage
    exit 2
    ;;
esac
