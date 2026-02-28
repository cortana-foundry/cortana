#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ERROR_PATTERNS = [
  "\\berror\\b",
  "\\bfailed\\b",
  "\\bexception\\b",
  "\\btraceback\\b",
  "\\bwarning\\b",
  "\\bdenied\\b",
  "\\bunavailable\\b",
  "\\bcrash(ed|ing)?\\b",
];

function run(cmd: string[]): { code: number; stdout: string; stderr: string } {
  const proc = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  return {
    code: proc.status ?? 1,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
  };
}

function resolveBinary(name: string, fallbacks: string[] = []): string | null {
  const which = spawnSync("which", [name], { encoding: "utf8" });
  const found = (which.stdout || "").trim();
  if (which.status === 0 && found) return found;
  for (const p of fallbacks) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function ensureDependencies(): [string, string] {
  const screencaptureBin = resolveBinary("screencapture", ["/usr/sbin/screencapture", "/usr/bin/screencapture"]);
  const tesseractBin = resolveBinary("tesseract", ["/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract"]);
  if (!screencaptureBin) throw new Error("screencapture is not available on this system");
  if (!tesseractBin) throw new Error("tesseract is not installed. Try: brew install tesseract");
  return [screencaptureBin, tesseractBin];
}

function captureScreenshot(
  screencaptureBin: string,
  imagePath: string,
  mode: string,
  windowId: string | null,
): Record<string, any> {
  const cmd = [screencaptureBin, "-x"];
  if (mode === "window") {
    if (!windowId) throw new Error("--window-id is required when --mode window");
    cmd.push("-l", String(windowId));
  }
  cmd.push(imagePath);
  const proc = run(cmd);
  if (proc.code !== 0) {
    throw new Error(`screencapture failed: ${(proc.stderr || proc.stdout).trim()}`);
  }
  const bytes = fs.existsSync(imagePath) ? fs.statSync(imagePath).size : 0;
  return { path: imagePath, bytes, mode, window_id: windowId };
}

function ocrImage(tesseractBin: string, imagePath: string, lang = "eng"): Record<string, any> {
  const cmd = [tesseractBin, imagePath, "stdout", "-l", lang, "--psm", "6"];
  const proc = run(cmd);
  if (proc.code !== 0) {
    throw new Error(`tesseract failed: ${(proc.stderr || proc.stdout).trim()}`);
  }
  const text = proc.stdout || "";
  const cleaned = text.trim();
  const lines = cleaned.split(/\r?\n/).filter((ln) => ln.trim());
  return {
    text: cleaned,
    line_count: lines.length,
    char_count: cleaned.length,
    language: lang,
  };
}

function getFrontmostApp(): Record<string, string | null> {
  const script =
    'tell application "System Events"\n' +
    'set p to first process whose frontmost is true\n' +
    'set appName to name of p\n' +
    'set winName to ""\n' +
    'try\n' +
    'set winName to name of front window of p\n' +
    'end try\n' +
    'return appName & "|||" & winName\n' +
    'end tell';

  const proc = run(["osascript", "-e", script]);
  if (proc.code !== 0) return { app_name: null, window_title: null };
  const out = (proc.stdout || "").trim();
  if (out.includes("|||")) {
    const [app, win] = out.split("|||", 2);
    return { app_name: app || null, window_title: win || null };
  }
  return { app_name: out || null, window_title: null };
}

function detectUiState(ocrText: string, frontmost: Record<string, any>): Record<string, any> {
  const lowered = (ocrText || "").toLowerCase();
  const matches: string[] = [];
  for (const pattern of ERROR_PATTERNS) {
    if (new RegExp(pattern, "i").test(lowered)) matches.push(pattern);
  }

  const signals: string[] = [];
  if (matches.length) signals.push("error_keywords_detected");

  const title = String(frontmost.window_title ?? "").toLowerCase();
  const appName = String(frontmost.app_name ?? "").toLowerCase();
  if (title.includes("dialog") || title.includes("alert")) signals.push("dialog_window_title");
  if (["error", "failed", "warning"].some((k) => title.includes(k)) ||
      ["crash", "report", "installer"].some((k) => appName.includes(k))) {
    signals.push("possible_error_window");
  }

  let severity = "normal";
  if (signals.includes("possible_error_window") || matches.length) severity = "warning";

  return { severity, signals, error_pattern_matches: matches };
}

function parseArgs(argv: string[]) {
  const args = {
    mode: "full",
    windowId: null as string | null,
    outputImage: null as string | null,
    lang: "eng",
    uiState: false,
    keepTemp: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i] ?? args.mode;
    else if (a === "--window-id") args.windowId = argv[++i] ?? null;
    else if (a === "--output-image") args.outputImage = argv[++i] ?? null;
    else if (a === "--lang") args.lang = argv[++i] ?? args.lang;
    else if (a === "--ui-state") args.uiState = true;
    else if (a === "--keep-temp") args.keepTemp = true;
  }

  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const started = new Date().toISOString();

  try {
    const [screencaptureBin, tesseractBin] = ensureDependencies();

    let imagePath: string;
    let tempUsed = false;

    if (args.outputImage) {
      const explicit = path.resolve(args.outputImage);
      fs.mkdirSync(path.dirname(explicit), { recursive: true });
      imagePath = explicit;
    } else {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-eye-"));
      imagePath = path.join(tmpDir, "capture.png");
      tempUsed = true;
    }

    const captureMeta = captureScreenshot(screencaptureBin, imagePath, args.mode, args.windowId);
    const ocrMeta = ocrImage(tesseractBin, imagePath, args.lang);

    const frontmost = args.uiState ? getFrontmostApp() : {};
    const uiState = args.uiState ? detectUiState(ocrMeta.text, frontmost) : null;

    const payload: Record<string, any> = {
      ok: true,
      timestamp_utc: started,
      capture: captureMeta,
      ocr: ocrMeta,
      frontmost: args.uiState ? frontmost : null,
      ui_state: uiState,
      engine: { ocr: "tesseract", platform: "macOS" },
    };

    if (tempUsed && !args.keepTemp) {
      try {
        fs.unlinkSync(imagePath);
        fs.rmdirSync(path.dirname(imagePath));
        payload.capture.path = null;
      } catch {
        // ignore
      }
    }

    console.log(JSON.stringify(payload, null, 2));
    return 0;
  } catch (err) {
    const payload = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      timestamp_utc: started,
    };
    console.error(JSON.stringify(payload, null, 2));
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
