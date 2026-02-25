#!/usr/bin/env python3
"""Multimodal Ops Eye capture tool.

Captures macOS screenshots, runs local OCR with tesseract, and returns structured JSON.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ERROR_PATTERNS = [
    r"\berror\b",
    r"\bfailed\b",
    r"\bexception\b",
    r"\btraceback\b",
    r"\bwarning\b",
    r"\bdenied\b",
    r"\bunavailable\b",
    r"\bcrash(ed|ing)?\b",
]


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, text=True, capture_output=True)


def resolve_binary(name: str, fallbacks: list[str] | None = None) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for p in fallbacks or []:
        if Path(p).exists():
            return p
    return None


def ensure_dependencies() -> tuple[str, str]:
    screencapture_bin = resolve_binary("screencapture", ["/usr/sbin/screencapture", "/usr/bin/screencapture"])
    tesseract_bin = resolve_binary("tesseract", ["/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract"])

    if screencapture_bin is None:
        raise RuntimeError("screencapture is not available on this system")
    if tesseract_bin is None:
        raise RuntimeError("tesseract is not installed. Try: brew install tesseract")

    return screencapture_bin, tesseract_bin


def capture_screenshot(screencapture_bin: str, path: Path, mode: str, window_id: str | None) -> dict[str, Any]:
    cmd = [screencapture_bin, "-x"]

    if mode == "window":
        if not window_id:
            raise RuntimeError("--window-id is required when --mode window")
        cmd.extend(["-l", str(window_id)])

    cmd.append(str(path))
    proc = run(cmd)
    if proc.returncode != 0:
        raise RuntimeError(f"screencapture failed: {proc.stderr.strip() or proc.stdout.strip()}")

    return {
        "path": str(path),
        "bytes": path.stat().st_size if path.exists() else 0,
        "mode": mode,
        "window_id": window_id,
    }


def ocr_image(tesseract_bin: str, image_path: Path, lang: str = "eng") -> dict[str, Any]:
    cmd = [tesseract_bin, str(image_path), "stdout", "-l", lang, "--psm", "6"]
    proc = run(cmd)
    if proc.returncode != 0:
        raise RuntimeError(f"tesseract failed: {proc.stderr.strip() or proc.stdout.strip()}")

    text = proc.stdout or ""
    cleaned = text.strip()
    lines = [ln for ln in cleaned.splitlines() if ln.strip()]

    return {
        "text": cleaned,
        "line_count": len(lines),
        "char_count": len(cleaned),
        "language": lang,
    }


def get_frontmost_app() -> dict[str, str | None]:
    script = (
        'tell application "System Events"\n'
        'set p to first process whose frontmost is true\n'
        'set appName to name of p\n'
        'set winName to ""\n'
        'try\n'
        'set winName to name of front window of p\n'
        'end try\n'
        'return appName & "|||" & winName\n'
        'end tell'
    )

    proc = run(["osascript", "-e", script])
    if proc.returncode != 0:
        return {"app_name": None, "window_title": None}

    out = (proc.stdout or "").strip()
    if "|||" in out:
        app, win = out.split("|||", 1)
        return {"app_name": app or None, "window_title": win or None}
    return {"app_name": out or None, "window_title": None}


def detect_ui_state(ocr_text: str, frontmost: dict[str, Any]) -> dict[str, Any]:
    lowered = (ocr_text or "").lower()
    matches = []
    for pattern in ERROR_PATTERNS:
        if re.search(pattern, lowered, re.IGNORECASE):
            matches.append(pattern)

    signals = []
    if matches:
        signals.append("error_keywords_detected")

    title = (frontmost.get("window_title") or "").lower()
    app_name = (frontmost.get("app_name") or "").lower()
    if "dialog" in title or "alert" in title:
        signals.append("dialog_window_title")
    if any(k in title for k in ["error", "failed", "warning"]) or any(
        k in app_name for k in ["crash", "report", "installer"]
    ):
        signals.append("possible_error_window")

    severity = "normal"
    if "possible_error_window" in signals or matches:
        severity = "warning"

    return {
        "severity": severity,
        "signals": signals,
        "error_pattern_matches": matches,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture screenshot + OCR + UI state JSON")
    parser.add_argument("--mode", choices=["full", "window"], default="full")
    parser.add_argument("--window-id", help="CGWindowID for --mode window")
    parser.add_argument("--output-image", help="Save screenshot to this path")
    parser.add_argument("--lang", default="eng", help="Tesseract language (default: eng)")
    parser.add_argument(
        "--ui-state",
        action="store_true",
        help="Include UI state detection (frontmost app + error heuristics)",
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Keep temp screenshot when --output-image is not provided",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    started = datetime.now(timezone.utc)

    try:
        screencapture_bin, tesseract_bin = ensure_dependencies()

        explicit_image = Path(args.output_image).expanduser() if args.output_image else None
        if explicit_image:
            explicit_image.parent.mkdir(parents=True, exist_ok=True)
            image_path = explicit_image
            temp_used = False
        else:
            tmp_dir = Path(tempfile.mkdtemp(prefix="ops-eye-"))
            image_path = tmp_dir / "capture.png"
            temp_used = True

        capture_meta = capture_screenshot(screencapture_bin, image_path, args.mode, args.window_id)
        ocr_meta = ocr_image(tesseract_bin, image_path, lang=args.lang)

        frontmost = get_frontmost_app() if args.ui_state else {}
        ui_state = detect_ui_state(ocr_meta["text"], frontmost) if args.ui_state else None

        payload: dict[str, Any] = {
            "ok": True,
            "timestamp_utc": started.isoformat(),
            "capture": capture_meta,
            "ocr": ocr_meta,
            "frontmost": frontmost if args.ui_state else None,
            "ui_state": ui_state,
            "engine": {"ocr": "tesseract", "platform": "macOS"},
        }

        if temp_used and not args.keep_temp:
            try:
                image_path.unlink(missing_ok=True)
                image_path.parent.rmdir()
                payload["capture"]["path"] = None
            except Exception:
                pass

        print(json.dumps(payload, indent=2))
        return 0

    except Exception as exc:
        err = {
            "ok": False,
            "error": str(exc),
            "timestamp_utc": started.isoformat(),
        }
        print(json.dumps(err, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
