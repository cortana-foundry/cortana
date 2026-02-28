#!/usr/bin/env npx tsx
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main(): Promise<void> {
  const py = "import json\n\nimport pytest\n\n\ndef test_route_workflow_plan_failure_retry_and_escalate(load_module):\n    mod = load_module(\"covenant/route_workflow.py\", \"route_workflow\")\n    retry = mod.plan_failure(\n        {\n            \"failure_type\": \"network_timeout\",\n            \"agent_identity_id\": \"agent.huragok.v1\",\n            \"attempt\": 1,\n            \"max_retries\": 2,\n        }\n    )\n    assert retry[\"action\"] == \"retry_same_agent\"\n    assert retry[\"state\"] == \"in_progress\"\n\n    esc = mod.plan_failure(\n        {\n            \"failure_type\": \"auth_failure\",\n            \"agent_identity_id\": \"agent.huragok.v1\",\n            \"attempt\": 1,\n            \"max_retries\": 2,\n        }\n    )\n    assert esc[\"action\"].startswith(\"escalate\")\n    assert esc[\"state\"] == \"blocked\"\n\n\ndef test_spawn_guard_normalization_and_key(load_module):\n    mod = load_module(\"covenant/spawn_guard.py\", \"spawn_guard\")\n    assert mod._norm_label(\" Huragok  migration___hygiene \") == \"huragok-migration-hygiene\"\n    assert mod.dedupe_key(\"Task Label\", 42) == \"task:42|label:task-label\"\n\n\ndef test_validate_agent_protocol_status_and_completion(load_module):\n    mod = load_module(\"covenant/validate_agent_protocol.py\", \"validate_protocol\")\n    defs = mod.load_schema_defs()\n\n    status = {\n        \"request_id\": \"r1\",\n        \"agent_identity_id\": \"agent.huragok.v1\",\n        \"state\": \"in_progress\",\n        \"confidence\": 0.7,\n        \"timestamp\": \"2026-02-26T10:00:00Z\",\n    }\n    completion = {\n        \"request_id\": \"r1\",\n        \"agent_identity_id\": \"agent.huragok.v1\",\n        \"state\": \"completed\",\n        \"summary\": \"done\",\n        \"artifacts\": [],\n        \"risks\": [],\n        \"follow_ups\": [],\n        \"confidence\": 0.8,\n        \"timestamp\": \"2026-02-26T10:05:00Z\",\n    }\n\n    mod.validate_status(status, defs)\n    mod.validate_completion(completion, defs)\n\n\ndef test_validate_agent_protocol_rejects_extra_field(load_module):\n    mod = load_module(\"covenant/validate_agent_protocol.py\", \"validate_protocol_bad\")\n    defs = mod.load_schema_defs()\n    bad = {\n        \"request_id\": \"r1\",\n        \"agent_identity_id\": \"agent.huragok.v1\",\n        \"state\": \"in_progress\",\n        \"confidence\": 0.7,\n        \"timestamp\": \"2026-02-26T10:00:00Z\",\n        \"extra\": True,\n    }\n    with pytest.raises(mod.ValidationError):\n        mod.validate_status(bad, defs)\n\n\ndef test_prepare_spawn_normalize_and_auto_route(monkeypatch, tmp_path, load_module):\n    mod = load_module(\"covenant/prepare_spawn.py\", \"prepare_spawn\")\n\n    raw = {\"mission\": \"Do thing\", \"expected_outcome\": \"Done\"}\n    normalized, notes = mod.normalize_payload(raw, legacy_shim=True)\n    assert normalized[\"objective\"] == \"Do thing\"\n    assert normalized[\"success_criteria\"] == [\"Done\"]\n    assert \"callback\" in normalized\n    assert notes\n\n    # auto-route path with mocked subprocess output\n    monkeypatch.setattr(mod, \"ROUTER\", tmp_path / \"route_workflow.py\")\n    mod.ROUTER.write_text(\"# mock\")\n\n    class FakeProc:\n        returncode = 0\n        stderr = \"\"\n        stdout = \"ROUTING_PLAN_JSON: \" + json.dumps({\"primary_agent_identity_id\": \"agent.oracle.v1\"})\n\n    monkeypatch.setattr(mod.subprocess, \"run\", lambda *a, **k: FakeProc())\n    out, notes2 = mod.maybe_auto_route_identity({\"objective\": \"x\"}, auto_route=True)\n    assert out[\"agent_identity_id\"] == \"agent.oracle.v1\"\n    assert notes2\n";
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
