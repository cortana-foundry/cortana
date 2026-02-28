#!/usr/bin/env npx tsx
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main(): Promise<void> {
  const py = "from datetime import datetime\n\n\ndef test_signal_fingerprint_normalized(load_module):\n    mod = load_module(\"proactive/detect.py\", \"proactive_detect\")\n    s = mod.Signal(source=\"email\", signal_type=\"x\", title=\"  Hello   World \", summary=\"\", confidence=0.8)\n    fp = s.fingerprint()\n    assert \"hello world\" in fp\n\n\ndef test_tokenize_filters_stopwords(load_module):\n    mod = load_module(\"proactive/detect.py\", \"proactive_detect_tok\")\n    toks = mod.tokenize(\"The meeting and project update for team\")\n    assert \"meeting\" not in toks\n    assert \"project\" not in toks\n    assert \"team\" not in toks\n\n\ndef test_correlate_requires_overlap_threshold(load_module):\n    mod = load_module(\"proactive/detect.py\", \"proactive_detect_corr\")\n    sigs = [\n        mod.Signal(source=\"calendar\", signal_type=\"a\", title=\"Client security review\", summary=\"Prepare threat model\", confidence=0.7),\n        mod.Signal(source=\"email\", signal_type=\"b\", title=\"Security review follow up\", summary=\"Client asked for prep\", confidence=0.7),\n    ]\n    out = mod.correlate(sigs)\n    assert len(out) == 1\n    assert out[0].signal_type == \"calendar_email_correlation\"\n    assert out[0].confidence >= 0.68\n\n\ndef test_persist_applies_min_confidence_and_task_threshold(monkeypatch, load_module):\n    mod = load_module(\"proactive/detect.py\", \"proactive_detect_persist\")\n    calls = []\n\n    def fake_run_psql(sql):\n        calls.append(sql)\n        if \"INSERT INTO cortana_proactive_signals\" in sql:\n            return \"101\"\n        return \"\"\n\n    monkeypatch.setattr(mod, \"run_psql\", fake_run_psql)\n\n    signals = [\n        mod.Signal(source=\"email\", signal_type=\"low\", title=\"Low\", summary=\"\", confidence=0.5),\n        mod.Signal(source=\"email\", signal_type=\"hi\", title=\"High\", summary=\"\", confidence=0.9),\n    ]\n    inserted, suggested = mod.persist(run_id=1, signals=signals, min_conf=0.66, create_tasks=True)\n    assert inserted == 1\n    assert suggested == 1\n    assert any(\"INSERT INTO cortana_tasks\" in c for c in calls)\n";
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
