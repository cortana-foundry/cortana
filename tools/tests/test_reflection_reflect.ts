#!/usr/bin/env npx tsx
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main(): Promise<void> {
  const py = "\n\ndef test_classify_task_failure_and_success(load_module):\n    mod = load_module(\"reflection/reflect.py\", \"reflection_reflect\")\n    t_fail = {\"title\": \"X\", \"description\": \"\", \"outcome\": \"failed due to error\", \"status\": \"completed\"}\n    t_ok = {\"title\": \"X\", \"description\": \"\", \"outcome\": \"all good\", \"status\": \"completed\"}\n\n    fail = mod._classify_task(t_fail)\n    ok = mod._classify_task(t_ok)\n\n    assert fail[0] == \"failure\"\n    assert ok[0] == \"success\"\n\n\ndef test_extract_rules_scores_and_repeat_rate(monkeypatch, load_module):\n    mod = load_module(\"reflection/reflect.py\", \"reflection_reflect_extract\")\n    rows = [\n        {\"feedback_type\": \"preference\", \"lesson\": \"Do X\", \"evidence_count\": 3, \"first_seen\": \"2026-02-20\", \"last_seen\": \"2026-02-26\"},\n        {\"feedback_type\": \"fact\", \"lesson\": \"Fact Y\", \"evidence_count\": 1, \"first_seen\": \"2026-02-21\", \"last_seen\": \"2026-02-25\"},\n    ]\n    monkeypatch.setattr(mod, \"_fetch_json\", lambda sql: rows)\n    rules, repeated_rate, total = mod._extract_rules(window_days=30)\n    assert len(rules) == 2\n    assert total == 4\n    assert repeated_rate == 50.0\n    assert rules[0].confidence >= rules[1].confidence\n\n\ndef test_upsert_rules_applies_when_threshold_met(monkeypatch, load_module):\n    mod = load_module(\"reflection/reflect.py\", \"reflection_reflect_upsert\")\n    applied = []\n    updates = []\n\n    monkeypatch.setattr(mod, \"_apply_rule_to_file\", lambda path, rule: applied.append((str(path), rule.rule_text)))\n    monkeypatch.setattr(mod, \"_run_psql\", lambda sql: updates.append(sql) or \"\")\n\n    rule = mod.ReflectionRule(\n        feedback_type=\"preference\",\n        rule_text=\"Keep updates concise\",\n        evidence_count=2,\n        first_seen=\"2026-02-20\",\n        last_seen=\"2026-02-26\",\n        confidence=0.9,\n    )\n    n = mod._upsert_rules(run_id=1, rules=[rule], auto_threshold=0.82)\n    assert n == 1\n    assert applied\n    assert any(\"status='applied'\" in q for q in updates)\n";
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
