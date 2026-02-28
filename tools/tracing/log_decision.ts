#!/usr/bin/env npx tsx
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main(): Promise<void> {
  const py = "#!/usr/bin/env python3\nfrom __future__ import annotations\n\nimport argparse\nimport json\nimport os\nimport subprocess\nimport sys\nimport uuid\n\n\ndef parse_json(value: str | None, field: str):\n    if not value:\n        return {}\n    try:\n        parsed = json.loads(value)\n    except json.JSONDecodeError as exc:\n        raise SystemExit(f\"Invalid JSON for {field}: {exc}\")\n    if not isinstance(parsed, dict):\n        raise SystemExit(f\"{field} must be a JSON object\")\n    return parsed\n\n\ndef main() -> int:\n    p = argparse.ArgumentParser(description=\"Log a cortana decision trace\")\n    p.add_argument(\"--trace-id\", default=str(uuid.uuid4()))\n    p.add_argument(\"--event-id\", type=int)\n    p.add_argument(\"--task-id\", type=int)\n    p.add_argument(\"--run-id\")\n    p.add_argument(\"--trigger\", required=True)\n    p.add_argument(\"--action-type\", required=True)\n    p.add_argument(\"--action-name\", required=True)\n    p.add_argument(\"--reasoning\")\n    p.add_argument(\"--confidence\", type=float)\n    p.add_argument(\"--outcome\", default=\"unknown\")\n    p.add_argument(\"--data-inputs\")\n    p.add_argument(\"--metadata\")\n    args = p.parse_args()\n\n    if args.confidence is not None and not (0 <= args.confidence <= 1):\n        raise SystemExit(\"confidence must be between 0 and 1\")\n\n    data_inputs = json.dumps(parse_json(args.data_inputs, \"--data-inputs\"))\n    metadata = json.dumps(parse_json(args.metadata, \"--metadata\"))\n\n    env = os.environ.copy()\n    env[\"PATH\"] = \"/opt/homebrew/opt/postgresql@17/bin:\" + env.get(\"PATH\", \"\")\n    db = env.get(\"CORTANA_DATABASE_URL\") or env.get(\"DATABASE_URL\") or \"cortana\"\n\n    sql = \"\"\"\n    INSERT INTO cortana_decision_traces (\n      trace_id,event_id,task_id,run_id,trigger_type,action_type,action_name,\n      reasoning,confidence,outcome,data_inputs,metadata\n    ) VALUES (\n      :'trace_id', NULLIF(:'event_id','')::bigint, NULLIF(:'task_id','')::bigint,\n      NULLIF(:'run_id',''), :'trigger', :'action_type', :'action_name',\n      NULLIF(:'reasoning',''), NULLIF(:'confidence','')::numeric, :'outcome',\n      :'data_inputs'::jsonb, :'metadata'::jsonb\n    )\n    ON CONFLICT (trace_id) DO UPDATE SET\n      event_id = EXCLUDED.event_id,\n      task_id = EXCLUDED.task_id,\n      run_id = EXCLUDED.run_id,\n      trigger_type = EXCLUDED.trigger_type,\n      action_type = EXCLUDED.action_type,\n      action_name = EXCLUDED.action_name,\n      reasoning = EXCLUDED.reasoning,\n      confidence = EXCLUDED.confidence,\n      outcome = EXCLUDED.outcome,\n      data_inputs = EXCLUDED.data_inputs,\n      metadata = EXCLUDED.metadata;\n    \"\"\"\n\n    cmd = [\n        \"psql\", db,\n        \"-v\", f\"trace_id={args.trace_id}\",\n        \"-v\", f\"event_id={'' if args.event_id is None else args.event_id}\",\n        \"-v\", f\"task_id={'' if args.task_id is None else args.task_id}\",\n        \"-v\", f\"run_id={'' if args.run_id is None else args.run_id}\",\n        \"-v\", f\"trigger={args.trigger}\",\n        \"-v\", f\"action_type={args.action_type}\",\n        \"-v\", f\"action_name={args.action_name}\",\n        \"-v\", f\"reasoning={'' if args.reasoning is None else args.reasoning}\",\n        \"-v\", f\"confidence={'' if args.confidence is None else args.confidence}\",\n        \"-v\", f\"outcome={args.outcome}\",\n        \"-v\", f\"data_inputs={data_inputs}\",\n        \"-v\", f\"metadata={metadata}\",\n        \"-c\", sql,\n    ]\n    subprocess.run(cmd, env=env, check=True)\n\n    print(json.dumps({\"ok\": True, \"trace_id\": args.trace_id}))\n    return 0\n\n\nif __name__ == \"__main__\":\n    try:\n        raise SystemExit(main())\n    except subprocess.CalledProcessError as exc:\n        print(f\"failed to log decision trace: {exc}\", file=sys.stderr)\n        raise SystemExit(1)\n";
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
