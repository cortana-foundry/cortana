---
name: bird
description: >
  X/Twitter CLI for reading, searching, and posting tweets via cookies or Sweetistics.
  USE WHEN: Read/post tweets, check mentions/notifications, search Twitter, get social sentiment on stocks/topics.
  DON'T USE: General news gathering (use news-summary or web_search), non-Twitter social media.
homepage: https://bird.fast
metadata: {"clawdbot":{"emoji":"🐦","requires":{"bins":["bird"]},"install":[{"id":"brew","kind":"brew","formula":"steipete/tap/bird","bins":["bird"],"label":"Install bird (brew)"}]}}
---

# bird

Use `bird` to read/search X and post tweets/replies.

## When NOT to Use This Skill

❌ "What's in the news today?" → Use **news-summary** skill
❌ "Search the web for X" → Use **web_search** tool
❌ "Post to Instagram/LinkedIn/Facebook" → Not supported
❌ "Read my Discord messages" → Use **discord** skill

Quick start
- `bird whoami`
- `bird read <url-or-id>`
- `bird thread <url-or-id>`
- `bird search "query" -n 5`

Posting (confirm with user first)
- `bird tweet "text"`
- `bird reply <id-or-url> "text"`

Auth sources
- Browser cookies (default: Firefox/Chrome)
- Sweetistics API: set `SWEETISTICS_API_KEY` or use `--engine sweetistics`
- Check sources: `bird check`
