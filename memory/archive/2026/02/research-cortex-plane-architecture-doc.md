# Cortex Plane Architecture Doc (Google Doc Export)
# Saved: 2026-02-26

Source: https://docs.google.com/document/d/1uyPSQbtYVPBFvHzOYQtm_SOM2PTmHcn-iB79kyfYtC0

## 6 Gaps Covered:
1. LLM Memory Extraction Pipeline (JSONL → Qdrant, batched extraction, dedup/supersession)
2. PostgreSQL on k3s (CloudNativePG 2-node HA, WAL archiving to MinIO, Graphile Worker)
3. Observability & Telemetry (OpenTelemetry → Langfuse, Insights Agent, Pino → Loki)
4. Multi-Provider LLM Failover (circuit breaker, capability tiers, session stickiness)
5. Skills Framework in Containers (readOnlyRootFilesystem + subPath RW, hot-reload, progressive disclosure)
6. Dashboard & Real-Time UI (SSE streaming, approval mechanics, screenshot polling)

## Key Architecture Decisions:
- k3s on Proxmox homelab, 1-5 concurrent agents
- Graphile Worker as durable state machine / job orchestrator
- Qdrant for Tier 3 global vector memory
- JSONL session buffers for crash-resilient short-term memory
- CloudNativePG with local-path NVMe storage
- Langfuse for LLM-specific tracing (not Jaeger/Tempo)
- Capability-tiered failover (never downgrade tier)
- Next.js 15 dashboard with SSE
