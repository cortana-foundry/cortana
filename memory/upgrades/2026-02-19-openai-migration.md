# OpenAI Migration Plan

**Decision date:** Feb 19, 2026
**Status:** Completed (updated Feb 23, 2026)

## Why
- Single provider for LLM + embeddings (one key, one bill)
- Codex is cheaper than Opus — stretches budget further
- Unlocks memory search (2,500+ files, semantic recall)
- Hamel believes OpenAI is key to our future

## Migration Steps (status)
1. ✅ **Re-auth Codex** — `openclaw models auth login --provider openai-codex` (done Feb 19)
2. ✅ **Switch primary model** — now using `openai-codex/gpt-5.3-codex` as primary; Anthropic/Opus kept as fallback during transition
3. ✅ **Set up OpenAI embeddings** — memory search enabled with provider `openai` and model `text-embedding-3-small` (files + sessions)
4. ✅ **Update sub-agent model** — sub-agent default set to `openai-codex/gpt-5.3-codex` (no Sonnet default)
5. ✅ **Test everything** — Feb 23 quick checks: cron history reviewed (Tonal health check intermittently timing out but latest run OK), fitness service endpoints 200, gog Gmail search works, gateway healthy
6. ✅ **Tune SOUL.md / AGENTS.md** — reviewed for provider-specific language; no Anthropic-only references; OpenAI now primary
7. 🟡 **Remove Opus fallback** — **PENDING STABILITY CONFIRMATION** (do not remove yet)

## Risks & Mitigations
- **Personality shift** — Cortana's voice is defined in SOUL.md/MEMORY.md, not the model. May need prompt tuning.
- **Reasoning quality** — Opus excels at nuance/multi-step. Monitor for regressions in complex tasks.
- **Tool usage** — Different models handle tool calls differently. Test cron prompts.
- **Cost** — Should decrease significantly. Track via watchdog budget checks.

## What Carries Over (model-independent)
- SOUL.md (personality, dynamic, tone)
- MEMORY.md (all learned context, preferences, rules)
- AGENTS.md (operating procedures)
- All cron jobs, skills, database tables
- The Cortana/Chief partnership

## Success Criteria
- All crons fire without errors for 48h
- Morning briefs quality maintained
- Watchdog/healthchecks pass
- Memory search functional (indexed files > 0)
- Hamel vibes with the output
