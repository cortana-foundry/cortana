# Knowledge Base

Cortana's second brain. Persistent knowledge accumulated by The Covenant.

## Structure

```
knowledge/
├── README.md          # This file
├── INDEX.md           # Master index of all knowledge
├── research/          # Huragok outputs (deep-dive research)
├── patterns/          # Monitor outputs (behavioral patterns)
├── topics/            # Librarian outputs (domain knowledge)
│   ├── finance/
│   ├── tech/
│   ├── health/
│   └── career/
└── predictions/       # Oracle outputs (forecasts + accuracy tracking)
```

## Conventions

- **Filenames**: `YYYY-MM-DD-slug.md` for dated content, `slug.md` for evergreen
- **Frontmatter**: Include source, confidence, freshness date
- **Cross-links**: Use `[[wiki-style]]` links between related notes
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
