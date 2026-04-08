# Fitness Tracking

This directory stores Hamel's daily fitness data from Whoop and Tonal.

## Structure
- `YYYY-MM-DD.json` - Daily fitness snapshots (morning + evening data)
- `weekly/` - Weekly summary reports
- `programs/current-tonal-catalog.json` - Generated observed Tonal workout/movement catalog
- `programs/tonal-public-movement-catalog.json` - Generated public Tonal movement library scrape with `pplBucket` and `metricReady`
- `programs/tonal-ppl-v1.json` - Curated Tonal-supported push/pull/legs split built from the public catalog plus your observed machine history

## Data Sources
- **Whoop**: Sleep, recovery, strain, HRV, workouts
- **Tonal**: Strength scores, workout details, volume, exercises

## Cron Schedule (ET)
- 7:00am - Morning brief (sleep/recovery + workout if done)
- 8:30pm - Evening recap (full day summary)
- Sunday 8pm - Weekly insights

## Service Endpoints
- `http://localhost:3033/whoop/data` - Whoop API (auto-refreshes tokens)
- `http://localhost:3033/tonal/data` - Tonal API (cached workout history)

## Catalog Builders
- `npx tsx tools/fitness/tonal-public-movement-catalog.ts` - Scrape Tonal's public Movement Library pages into a local catalog for PPL planning and Tonal-valid exercise selection
- `npx tsx tools/fitness/tonal-ppl-v1.ts` - Build a committed PPL v1 artifact from Tonal-valid movements that are actually present in your own history
