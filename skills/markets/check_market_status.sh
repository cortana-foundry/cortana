#!/bin/bash

# Check if today is a market holiday or early close
# Returns: OPEN | CLOSED: Holiday Name | EARLY CLOSE 1:00 PM ET: Holiday Name

# Get today's date in YYYY-MM-DD format
TODAY=$(date +%Y-%m-%d)

# Get day of week (0=Sunday, 6=Saturday)
DOW=$(date +%w)

# Check if it's a weekend
if [[ $DOW -eq 0 || $DOW -eq 6 ]]; then
    echo "CLOSED: Weekend"
    exit 0
fi

# Check market holidays (2026)
case $TODAY in
    "2026-01-01")
        echo "CLOSED: New Year's Day"
        ;;
    "2026-01-19")  
        echo "CLOSED: Martin Luther King Jr. Day"
        ;;
    "2026-02-16")
        echo "CLOSED: Presidents' Day"
        ;;
    "2026-04-03")
        echo "CLOSED: Good Friday"
        ;;
    "2026-05-25")
        echo "CLOSED: Memorial Day"
        ;;
    "2026-06-19")
        echo "CLOSED: Juneteenth Holiday"
        ;;
    "2026-07-03")
        echo "CLOSED: Independence Day"
        ;;
    "2026-09-07")
        echo "CLOSED: Labor Day"
        ;;
    "2026-11-26")
        echo "CLOSED: Thanksgiving Day"
        ;;
    "2026-12-25")
        echo "CLOSED: Christmas Day"
        ;;
    "2026-11-27")
        echo "EARLY CLOSE 1:00 PM ET: Day after Thanksgiving"
        ;;
    "2026-12-24")
        echo "EARLY CLOSE 1:00 PM ET: Christmas Eve"
        ;;
    *)
        echo "OPEN"
        ;;
esac