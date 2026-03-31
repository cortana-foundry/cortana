#!/usr/bin/env npx tsx

export type MarketSessionPhase = "PREMARKET" | "OPEN" | "AFTER_HOURS" | "CLOSED";

type SessionInfo = {
  phase: MarketSessionPhase;
  label: string;
  sessionDate: string;
};

const HOLIDAY_LABELS: Record<string, string> = {
  "2026-01-01": "CLOSED: New Year's Day",
  "2026-01-19": "CLOSED: Martin Luther King Jr. Day",
  "2026-02-16": "CLOSED: Presidents' Day",
  "2026-04-03": "CLOSED: Good Friday",
  "2026-05-25": "CLOSED: Memorial Day",
  "2026-06-19": "CLOSED: Juneteenth Holiday",
  "2026-07-03": "CLOSED: Independence Day",
  "2026-09-07": "CLOSED: Labor Day",
  "2026-11-26": "CLOSED: Thanksgiving Day",
  "2026-12-25": "CLOSED: Christmas Day",
};

const EARLY_CLOSE_LABELS: Record<string, string> = {
  "2026-11-27": "EARLY CLOSE 1:00 PM ET: Day after Thanksgiving",
  "2026-12-24": "EARLY CLOSE 1:00 PM ET: Christmas Eve",
};

function getEtParts(now: Date): { sessionDate: string; weekday: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const sessionDate = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const minutes = Number.parseInt(lookup.hour ?? "0", 10) * 60 + Number.parseInt(lookup.minute ?? "0", 10);
  return {
    sessionDate,
    weekday: lookup.weekday ?? "",
    minutes,
  };
}

export function getMarketSessionInfo(now = new Date()): SessionInfo {
  const { sessionDate, weekday, minutes } = getEtParts(now);
  if (weekday === "Sat" || weekday === "Sun") {
    return { phase: "CLOSED", label: "CLOSED: Weekend", sessionDate };
  }
  const holiday = HOLIDAY_LABELS[sessionDate];
  if (holiday) {
    return { phase: "CLOSED", label: holiday, sessionDate };
  }

  const closeMinutes = EARLY_CLOSE_LABELS[sessionDate] ? 13 * 60 : 16 * 60;
  if (minutes < 9 * 60 + 30) {
    return { phase: "PREMARKET", label: "PREMARKET", sessionDate };
  }
  if (minutes < closeMinutes) {
    if (EARLY_CLOSE_LABELS[sessionDate]) {
      return { phase: "OPEN", label: `OPEN (${EARLY_CLOSE_LABELS[sessionDate]})`, sessionDate };
    }
    return { phase: "OPEN", label: "OPEN", sessionDate };
  }
  if (minutes < 20 * 60) {
    if (EARLY_CLOSE_LABELS[sessionDate]) {
      return { phase: "AFTER_HOURS", label: `AFTER_HOURS (${EARLY_CLOSE_LABELS[sessionDate]})`, sessionDate };
    }
    return { phase: "AFTER_HOURS", label: "AFTER_HOURS", sessionDate };
  }
  return { phase: "CLOSED", label: "CLOSED", sessionDate };
}

export function getMarketStatus(now = new Date()): string {
  return getMarketSessionInfo(now).label;
}

function main(): void {
  console.log(getMarketStatus());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
