# LLM Wiki Workflow

This file defines the operating workflow for `cortana` research topics.

It is the explicit process behind the markdown-first knowledge system:

- `research/raw/` = source corpus
- `research/derived/` = synthesized working layer
- `knowledge/` = compiled current truth

## Agent Read Order

When an LLM needs to answer or act on a topic:

1. read `knowledge/` first for current truth
2. read `research/derived/` second for evidence and nuance
3. read `research/raw/` last when source inspection is needed

Do not start from raw papers if the answer already exists in `knowledge/`.

## New Source Intake

When a new PDF, article, or source document arrives:

1. place it in `research/raw/<topic>/`
2. keep it in source form when possible
3. if it is a PDF corpus, place it in `research/raw/<topic>/pdfs/`
4. if the filename is poor, use the real title from the document when indexing it

Examples:

- Spartan papers -> `research/raw/spartan/pdfs/`
- OpenClaw architecture research -> `research/raw/openclaw/`

## Raw-Layer Update Rules

After adding new source material:

1. update or create a raw topic README
2. update the topic inventory/index file
3. normalize titles so future LLM passes do not depend on messy filenames
4. group the source into one or more topic buckets

For a paper corpus, the inventory should answer:

- what the paper is called
- what bucket it belongs to
- why it matters

## Bucketing Rule

Classify new material by subject, not by source or date alone.

For Spartan, current buckets include:

- strength
- hypertrophy
- conditioning
- recovery
- readiness and fatigue
- nutrition
- body composition
- velocity-based training

If a source fits multiple buckets, reference it in all relevant derived summaries instead of creating duplicate raw files.

## Derived-Layer Workflow

Once raw intake is updated:

1. read the new source
2. decide which derived topic files it affects
3. add paper-level notes or synthesis to the matching files in `research/derived/<topic>/`
4. update the topic evidence map if the new source changes the shape of the evidence
5. keep derived docs as synthesis, not as final policy

Derived docs should answer:

- what the evidence says
- how strong it is
- what it might imply
- what still looks uncertain

## Promotion Gate

Promote from `research/derived/` into `knowledge/` only when the conclusion is:

- durable
- repeated across multiple sources or otherwise high-confidence
- operationally useful
- specific enough to change current truth

Promote into `docs/source/` instead when the output becomes:

- a roadmap change
- a planning artifact
- a runbook
- an architecture note

## Promotion Targets In `cortana`

Typical promotion targets are:

- `knowledge/domains/<topic>/...`
- `knowledge/indexes/...`
- `docs/source/planning/...`
- `docs/source/architecture/...`

For Spartan specifically:

- current truth belongs in `knowledge/domains/spartan/`
- exploratory evidence belongs in `research/derived/spartan/`
- planning belongs in `docs/source/planning/spartan/`

## When Not To Promote

Do not promote when:

- the source is interesting but not durable
- the evidence is still mixed
- the conclusion is too vague to affect behavior
- the note is only useful as a temporary comparison or scratch synthesis

In that case, keep it in `research/derived/`.

## End-To-End Example

When a new Spartan paper arrives:

1. drop the PDF into `research/raw/spartan/pdfs/`
2. add it to `research/raw/spartan/corpus-inventory.md`
3. classify it into the right bucket(s)
4. update the relevant `research/derived/spartan/*.md` files
5. if it changes stable coaching rules, update `knowledge/domains/spartan/`
6. if it changes roadmap or implementation direction, update `docs/source/planning/spartan/`

## Final Rule

The LLM should rarely write straight into `knowledge/` from a brand-new source.

The normal flow is:

`raw -> derived -> knowledge`

That is the main discipline that keeps the wiki trustworthy.
