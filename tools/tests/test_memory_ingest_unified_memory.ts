#!/usr/bin/env npx tsx
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main(): Promise<void> {
  const py = "from datetime import datetime, timezone\n\n\ndef test_fp_stable_and_order_sensitive(load_module):\n    mod = load_module(\"memory/ingest_unified_memory.py\", \"ingest_unified_memory\")\n    a = mod.fp(\"x\", \"y\")\n    b = mod.fp(\"x\", \"y\")\n    c = mod.fp(\"y\", \"x\")\n    assert a == b\n    assert a != c\n    assert len(a) == 32\n\n\ndef test_quality_gate_disabled_promotes(load_module):\n    mod = load_module(\"memory/ingest_unified_memory.py\", \"ingest_unified_memory_qg\")\n    out = mod.quality_gate(\"hello\", enabled=False, dry=True)\n    assert out[\"verdict\"] == \"promote\"\n\n\ndef test_quality_gate_missing_script_promotes(monkeypatch, load_module):\n    mod = load_module(\"memory/ingest_unified_memory.py\", \"ingest_unified_memory_missing_gate\")\n\n    class MissingGate:\n        def exists(self):\n            return False\n\n    monkeypatch.setattr(mod, \"WORKSPACE\", mod.Path(\"/tmp/does-not-exist\"))\n    out = mod.quality_gate(\"abc\", enabled=True, dry=False)\n    assert out[\"verdict\"] == \"promote\"\n    assert out[\"reason\"] == \"gate_missing\"\n\n\ndef test_ingest_feedback_dry_run_counts_rows(monkeypatch, load_module):\n    mod = load_module(\"memory/ingest_unified_memory.py\", \"ingest_unified_memory_feedback\")\n\n    rows = \"1|2026-02-25T10:00:00+00:00|preference|ctx1|lesson1\\n2|2026-02-25T11:00:00+00:00|fact|ctx2|lesson2\"\n\n    def fake_psql(sql, capture=False):\n        assert \"FROM cortana_feedback\" in sql\n        return rows\n\n    monkeypatch.setattr(mod, \"psql\", fake_psql)\n    c = {\"e\": 0, \"s\": 0, \"p\": 0, \"v\": 0}\n    mod.ingest_feedback(run_id=-1, since=datetime.now(timezone.utc), c=c, dry=True)\n    assert c == {\"e\": 2, \"s\": 2, \"p\": 2, \"v\": 6}\n\n\ndef test_ingest_feedback_skips_archived_via_quality_gate(monkeypatch, load_module):\n    mod = load_module(\"memory/ingest_unified_memory.py\", \"ingest_unified_memory_feedback_archive\")\n\n    def fake_psql(sql, capture=False):\n        return \"1|2026-02-25T10:00:00+00:00|preference|ctx|lesson\"\n\n    monkeypatch.setattr(mod, \"psql\", fake_psql)\n    monkeypatch.setattr(mod, \"quality_gate\", lambda text, enabled, dry: {\"verdict\": \"archive\"})\n\n    c = {\"e\": 0, \"s\": 0, \"p\": 0, \"v\": 0}\n    mod.ingest_feedback(run_id=1, since=datetime.now(timezone.utc), c=c, dry=False, use_quality_gate=True)\n    assert c == {\"e\": 0, \"s\": 0, \"p\": 0, \"v\": 0}\n";
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
