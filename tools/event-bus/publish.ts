#!/usr/bin/env npx tsx
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main(): Promise<void> {
  const py = "#!/usr/bin/env python3\n\"\"\"Publish events into Cortana event bus via PostgreSQL function.\"\"\"\n\nfrom __future__ import annotations\n\nimport argparse\nimport json\nimport os\nimport subprocess\nimport sys\n\nPSQL_BIN = \"/opt/homebrew/opt/postgresql@17/bin/psql\"\nALLOWED_EVENT_TYPES = {\n    \"email_received\",\n    \"task_created\",\n    \"calendar_approaching\",\n    \"portfolio_alert\",\n    \"health_update\",\n}\n\n\ndef parse_args() -> argparse.Namespace:\n    parser = argparse.ArgumentParser(description=\"Publish an event to Cortana bus\")\n    parser.add_argument(\"event_type\", choices=sorted(ALLOWED_EVENT_TYPES))\n    parser.add_argument(\"--db\", default=\"cortana\")\n    parser.add_argument(\"--source\", default=\"manual\")\n    parser.add_argument(\n        \"--payload\",\n        default=\"{}\",\n        help=\"JSON payload inline (default: {})\",\n    )\n    parser.add_argument(\"--payload-file\", help=\"Path to JSON payload file\")\n    parser.add_argument(\"--correlation-id\", help=\"Optional UUID correlation id\")\n    return parser.parse_args()\n\n\ndef sql_quote(value: str) -> str:\n    return value.replace(\"'\", \"''\")\n\n\ndef load_payload(args: argparse.Namespace) -> dict:\n    if args.payload_file:\n        with open(args.payload_file, \"r\", encoding=\"utf-8\") as f:\n            return json.load(f)\n    return json.loads(args.payload)\n\n\ndef main() -> int:\n    args = parse_args()\n\n    try:\n        payload_obj = load_payload(args)\n    except json.JSONDecodeError as exc:\n        print(f\"Invalid JSON payload: {exc}\", file=sys.stderr)\n        return 2\n\n    payload_json = json.dumps(payload_obj, ensure_ascii=False)\n    source_sql = sql_quote(args.source)\n    payload_sql = sql_quote(payload_json)\n\n    corr_sql = \"NULL\"\n    if args.correlation_id:\n        corr_sql = f\"'{sql_quote(args.correlation_id)}'::uuid\"\n\n    sql = (\n        \"SELECT cortana_event_bus_publish(\"\n        f\"'{args.event_type}', \"\n        f\"'{source_sql}', \"\n        f\"'{payload_sql}'::jsonb, \"\n        f\"{corr_sql}\"\n        \");\"\n    )\n\n    env = os.environ.copy()\n    env[\"PATH\"] = \"/opt/homebrew/opt/postgresql@17/bin:\" + env.get(\"PATH\", \"\")\n\n    proc = subprocess.run(\n        [PSQL_BIN, args.db, \"-X\", \"-q\", \"-At\", \"-c\", sql],\n        capture_output=True,\n        text=True,\n        env=env,\n    )\n\n    if proc.returncode != 0:\n        print(proc.stderr.strip() or \"publish failed\", file=sys.stderr)\n        return proc.returncode\n\n    event_id = proc.stdout.strip()\n    print(json.dumps({\"ok\": True, \"event_id\": int(event_id), \"event_type\": args.event_type}))\n    return 0\n\n\nif __name__ == \"__main__\":\n    raise SystemExit(main())\n";
  const dir = mkdtempSync(join(tmpdir(), 'pywrap-'));
  const script = join(dir, 'script.py');
  writeFileSync(script, py, 'utf8');
  const proc = spawnSync('python3', [script, ...process.argv.slice(2)], { stdio: 'inherit' });
  rmSync(dir, { recursive: true, force: true });
  if (proc.error) {
    console.error(String(proc.error));
    process.exit(1);
  }
  process.exit(proc.status ?? 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
