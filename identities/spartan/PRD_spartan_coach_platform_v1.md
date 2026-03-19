# PRD — Spartan Coach Platform v1

## 1) Product Goal
Build Spartan into a full-stack longevity performance coach for Hamel: daily readiness decisions, training prescriptions, diet guidance, recovery management, and persistent memory/logging of all coaching interactions.

**North Star:** maximize probability of healthy lifespan to age 100 through consistent, data-driven execution.

## 2) Users
- Primary user: Hamel (direct Telegram coaching)
- System operator: Spartan (AI coach)

## 3) Problem Statement
Current coaching is strong but fragmented:
- Data exists across Whoop, Tonal, chat, and notes.
- Conversation insights are not consistently structured in durable storage.
- Nutrition and training decisions are not unified into one decision engine.

## 4) Scope (v1)
### In Scope
1. **Unified Daily Decision Engine**
   - Inputs: Whoop recovery/sleep, Tonal workouts, recent strain, prior 7-day trends.
   - Output: readiness call (Green/Yellow/Red), top risk, longevity impact, one concrete action.

2. **Training Coach Layer**
   - Daily prescription: push/hold/recover.
   - Modality selector: lift / cardio / mixed / recovery.
   - Guardrails to prevent high-strain stacking.

3. **Nutrition Coach Layer (non-medical)**
   - Daily protein target tracking (112–140g/day from existing memory targets).
   - Meal consistency prompts and hydration guidance.
   - Recovery-sensitive nutrition reminders (e.g., post-hard session protein timing).

4. **Conversation + Decision Logging**
   - Every inbound/outbound coaching exchange logged.
   - Structured decision log (readiness, reason, prescription, compliance status).
   - Event tagging (sleep debt, overreach risk, high strain day, missed protein).

5. **Weekly Insight Generator**
   - Trend summary: wins, risks, and 2–3 next-week priorities.
   - Automatic markdown export to weekly directory.

### Out of Scope (v1)
- Medical diagnosis/treatment recommendations.
- Advanced blood biomarker integrations.
- Fully autonomous behavior changes without Hamel confirmation.

## 5) Functional Requirements
### FR-1 Daily Morning Brief
- Trigger: manual request or scheduled morning run.
- Must output:
  - longevity impact (positive/neutral/negative)
  - top risk to age-100 objective
  - readiness call
  - brief data-backed reason
  - one concrete action today

### FR-2 Session Analyzer
- On workout completion request (“check my whoop”), fetch latest workouts and detect sync artifacts.
- If data incomplete/duplicated, return uncertainty + safe fallback action.

### FR-3 Recovery Gate
- Block recommendation of additional high intensity when current day strain is above threshold.
- Shift to mobility/core/recovery when risk is elevated.

### FR-4 Nutrition Check
- Daily simple nutrition status:
  - protein target status: on track / behind / unknown
  - hydration status prompt
  - one tactical adjustment

### FR-5 Durable Logging
- Persist every coaching interaction and decision in DB tables.
- Store: timestamp, context, readiness, prescription, user intent, follow-through markers.

### FR-6 Weekly Report
- Auto-generate weekly analysis markdown and save to:
  - `/Users/hd/Developer/cortana/memory/fitness/weekly/`

## 6) Non-Functional Requirements
- **Reliability:** tolerate API lag/partial sync from wearables.
- **Explainability:** always include reason for each recommendation.
- **Safety:** conservative fallback when data is stale/missing.
- **Latency:** daily brief response target <10s after data fetch.

## 7) Data Model (Proposed)
### Table: `coach_conversation_log`
- id (uuid)
- ts_utc (timestamptz)
- channel (text)
- direction (enum: inbound/outbound)
- message_text (text)
- intent (text)
- tags (jsonb)

### Table: `coach_decision_log`
- id (uuid)
- ts_utc (timestamptz)
- readiness_call (text)
- longevity_impact (text)
- top_risk (text)
- reason_summary (text)
- prescribed_action (text)
- actual_day_strain (numeric)
- sleep_perf_pct (numeric)
- recovery_score (numeric)
- compliance_status (text, nullable)

### Table: `coach_nutrition_log`
- id (uuid)
- date_local (date)
- protein_target_g (int)
- protein_actual_g (int, nullable)
- hydration_status (text)
- notes (text)

## 8) Decision Logic (v1)
1. Pull latest Whoop + Tonal.
2. Validate freshness and deduplicate workouts by id.
3. Compute readiness gate:
   - Green: recovery high + no acute risk
   - Yellow: moderate or conflicting signals
   - Red: low recovery/sleep debt/high accumulated strain
4. Check same-day load before prescribing additional intensity.
5. Produce concise recommendation + log output.

## 9) Success Metrics
- 90%+ days with complete decision logs.
- Reduction in high-strain stacking events week-over-week.
- Improved sleep consistency trend over 4 weeks.
- Protein adherence trend toward 112–140g/day.
- Fewer “uncertain recommendation” events due to better data handling.

## 10) Delivery Plan
### Phase 1 (2–4 days)
- Implement DB schema + logging pipeline.
- Add structured morning brief output enforcement.

### Phase 2 (3–5 days)
- Add workout sync artifact detection + robust session analyzer.
- Add nutrition check block and daily protein tracking stub.

### Phase 3 (3–5 days)
- Weekly insight auto-writer + trend scoring.
- Add compliance tracking (did prescribed action happen?).

## 11) Risks & Mitigations
- **Risk:** wearable sync lag causes bad calls.
  - **Mitigation:** freshness checks + fallback + re-pull cadence.
- **Risk:** over-complex output reduces adherence.
  - **Mitigation:** keep default response 2–5 lines with one action.
- **Risk:** missing nutrition data.
  - **Mitigation:** label unknown explicitly and give minimal next step.

## 12) Open Questions for Hamel
1. Do you want automatic scheduled morning/evening briefs daily?
- YesZ
2. Should nutrition tracking be manual check-ins first, or integrated from another source later?
- Yes, manual check-ins first - another source will be coming soon im working on something
3. Do you want a weekly score (0–100) for “age-100 alignment”?
- Yes, that would be interesting to have as a high-level summary metric
4. Should Spartan proactively send warnings when strain stacking risk is detected?
- Yes, proactive warnings would be helpful to prevent overreach.

---
Prepared by Spartan (Codex 5.3)
Date: 2026-03-19 (America/New_York)
