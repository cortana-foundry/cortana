# Knowledge Base

Cortana's second brain.

This directory now contains two layers:

1. Covenant-produced knowledge artifacts
2. Canonical current-truth domain pages

## Structure

```text
knowledge/
├── README.md              # This file
├── INDEX.md               # Legacy knowledge registry
├── indexes/               # Canonical navigation pages
├── domains/               # Current-truth domain pages
├── research/              # Huragok outputs
├── patterns/              # Monitor outputs
├── topics/                # Librarian outputs
└── predictions/           # Oracle outputs
```

## Start Here

- [Systems index](./indexes/systems.md)
- [Cortana core overview](./domains/cortana-core/overview.md)
- [Memory system overview](./domains/memory-system/overview.md)
- [Covenant overview](./domains/covenant/overview.md)

## Conventions

- **Filenames**: `YYYY-MM-DD-slug.md` for dated content, `slug.md` for evergreen
- **Frontmatter**: Include source, confidence, freshness date
- **Cross-links**: use relative markdown links for canonical domain pages; older Covenant notes may still use wiki-style conventions
- **Tags**: Use consistent tags for discoverability

## Freshness

Knowledge decays. Each note should include:
- `created`: When this was written
- `updated`: Last modification
- `review_by`: When this should be re-evaluated (optional)

## Quality Tiers

- **Verified**: Multiple reliable sources, high confidence
- **Probable**: Good sources, reasonable confidence
- **Speculative**: Limited sources, flag uncertainty
- **Stale**: Needs re-evaluation
