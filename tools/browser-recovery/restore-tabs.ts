#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";

console.log("🔄 OpenClaw Browser Recovery");
console.log("==============================");

console.log("Killing existing Chrome instances...");
spawnSync("pkill", ["-9", "Google Chrome"], { stdio: "ignore" });
spawnSync("sleep", ["2"], { stdio: "ignore" });

console.log("Starting OpenClaw browser...");
spawnSync("curl", ["-s", "-X", "POST", "http://127.0.0.1:18790/browser", "-H", "Content-Type: application/json", "-d", '{"action":"start","profile":"openclaw"}'], { stdio: "ignore" });
spawnSync("sleep", ["3"], { stdio: "ignore" });

const tabs = [
  "http://homeassistant.local:8123",
  "https://mail.google.com",
  "https://calendar.google.com",
  "https://www.amazon.com/gp/your-account/order-history",
];

console.log("Opening tabs...");
for (const url of tabs) {
  console.log(`  → ${url}`);
  spawnSync("curl", ["-s", "-X", "POST", "http://127.0.0.1:18790/browser", "-H", "Content-Type: application/json", "-d", JSON.stringify({ action: "open", profile: "openclaw", targetUrl: url })], { stdio: "ignore" });
  spawnSync("sleep", ["1"], { stdio: "ignore" });
}

console.log("");
console.log(`✅ Browser restored with ${tabs.length} tabs`);
console.log("");
console.log("Note: You may need to log in to services (fresh browser profile)");
