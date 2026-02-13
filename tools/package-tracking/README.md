# Package Tracking Service (WIP)

**Status:** Prototype - testing before moving to services repo
**Created:** 2026-02-12

## Overview

Track packages from Amazon, UPS, FedEx, USPS without paid APIs.

## Components

### 1. trackpkg CLI (UPS/FedEx/USPS)

**Location:** `~/go/bin/trackpkg`
**Source:** github.com/jwalanta/trackpkg

```bash
# Add a package
~/go/bin/trackpkg add <tracking_number> "Description"

# Update all tracking info
~/go/bin/trackpkg update

# List all packages
~/go/bin/trackpkg list

# Get detailed history
~/go/bin/trackpkg detail <tracking_number>

# Remove delivered packages
~/go/bin/trackpkg clean
```

**Supported carriers:** UPS, FedEx, USPS (auto-detected from tracking number format)

**Limitations:**
- Auto-detection doesn't always work for all tracking number formats
- No Amazon Logistics support
- Last updated 2024 - some carrier websites may have changed
- FedEx 12-digit numbers may not be recognized

**Storage:** `~/.trackingrepo` (JSON file)

### 2. Browser Scraping (Amazon + Fallback)

For Amazon orders and when trackpkg fails, use browser automation:

**Amazon Orders Tab:** Chrome debug mode (port 9222)
- Hamel will set up a tab with Amazon orders page
- Cortana can scrape order status, tracking numbers, delivery dates

**Carrier Fallback:**
- Open carrier tracking page in browser
- Scrape status, location, delivery estimate
- Works for any carrier including Amazon Logistics

## Usage Patterns

### Track a new package
```bash
# Try trackpkg first
~/go/bin/trackpkg add 1Z999999999999999 "Amazon order - headphones"
~/go/bin/trackpkg update

# If carrier not detected, use browser scraping
# (Cortana will handle this automatically)
```

### Check all packages
```bash
~/go/bin/trackpkg list
```

### Get detailed tracking
```bash
~/go/bin/trackpkg detail 1
# or
~/go/bin/trackpkg detail 1Z999999999999999
```

## Chrome Debug Mode Setup

**Port:** 9222
**Profile:** `~/.chrome-debug-profile`

Tabs to set up (Hamel):
1. Amazon Orders page - for scraping order list
2. Amazon search/tracking - for looking up specific orders

## Integration with Cortana

Cortana can:
1. Accept tracking numbers via chat
2. Try trackpkg first for UPS/FedEx/USPS
3. Fall back to browser scraping if carrier not detected
4. Monitor packages and alert on status changes
5. Scrape Amazon orders tab for new tracking numbers

## TODO

- [ ] Test trackpkg with various tracking number formats
- [ ] Set up Amazon orders browser tab
- [ ] Create skill for package tracking
- [ ] Add cron job for periodic updates
- [ ] Handle Amazon Logistics tracking
- [ ] Move to services repo once stable

## Test Results

### FedEx 398672819562 (Valentine flowers)
- trackpkg: ❌ Carrier not detected
- Browser scrape: ✅ Works (tested 2026-02-12)

### UPS format (1Z...)
- trackpkg: TBD
- Browser scrape: TBD

### USPS format (92...)
- trackpkg: TBD
- Browser scrape: TBD
