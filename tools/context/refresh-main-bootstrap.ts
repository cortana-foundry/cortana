#!/usr/bin/env npx tsx

import fs from "node:fs";
import path from "node:path";
import { buildBootstrapContext, collectOperatorContext } from "./main-operator-context.ts";

const DEFAULT_OUTPUT = path.resolve("/Users/hd/Developer/cortana", "BOOTSTRAP.md");
const DEFAULT_MAIN_IDENTITY = path.resolve("/Users/hd/Developer/cortana", "identities", "main", "IDENTITY.md");
const ROOT_IDENTITY = path.resolve("/Users/hd/Developer/cortana", "IDENTITY.md");

export function writeMainBootstrap(outputPath = DEFAULT_OUTPUT): string {
  const content = `${buildBootstrapContext(collectOperatorContext())}\n`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  return content;
}

export function buildMainIdentityOverlay(bootstrapText: string, rootIdentityText: string): string {
  return [
    "# IDENTITY.md",
    "Cortana. Current operator-state snapshot first; durable identity below.",
    "",
    bootstrapText.trim(),
    "",
    "## Durable Identity",
    rootIdentityText.trim(),
    "",
  ].join("\n");
}

export function writeMainIdentityOverlay(outputPath = DEFAULT_MAIN_IDENTITY, rootIdentityPath = ROOT_IDENTITY): string {
  const bootstrapText = buildBootstrapContext(collectOperatorContext());
  const rootIdentityText = fs.readFileSync(rootIdentityPath, "utf8");
  const content = buildMainIdentityOverlay(bootstrapText, rootIdentityText);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  return content;
}

function main() {
  const outputArgIdx = process.argv.indexOf("--output");
  const outputPath = outputArgIdx >= 0 ? path.resolve(process.argv[outputArgIdx + 1] ?? DEFAULT_OUTPUT) : DEFAULT_OUTPUT;
  const content = writeMainBootstrap(outputPath);
  writeMainIdentityOverlay();
  process.stdout.write(content);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
