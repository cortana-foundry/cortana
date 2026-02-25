#!/usr/bin/env python3
"""
Approval gate for high-risk actions using Telegram inline buttons.

Import:
  from approval_gate import request_approval

CLI:
  python3 tools/guardrails/approval-gate.py --action "git push origin main" --risk high --timeout 300
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple
from uuid import uuid4


DEFAULT_CONFIG = os.path.expanduser("~/.openclaw/openclaw.json")
HIGH_RISK_KEYWORDS = (
    "external email",
    "send email",
    "git push",
    "push to main",
    "public post",
    "tweet",
    "x post",
    "linkedin",
)


@dataclass
class ApprovalResult:
    approved: bool
    reason: str


def _load_openclaw_config(path: str = DEFAULT_CONFIG) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _telegram_token(config_path: str = DEFAULT_CONFIG) -> str:
    env_token = os.getenv("TELEGRAM_BOT_TOKEN")
    if env_token:
        return env_token
    cfg = _load_openclaw_config(config_path)
    token = cfg.get("channels", {}).get("telegram", {}).get("botToken")
    if not token:
        raise RuntimeError("Telegram bot token not found. Set TELEGRAM_BOT_TOKEN or channels.telegram.botToken in ~/.openclaw/openclaw.json")
    return token


def _http_json(url: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if payload is not None else "GET")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _infer_chat_id(token: str) -> Optional[str]:
    res = _http_json(f"https://api.telegram.org/bot{token}/getUpdates")
    if not res.get("ok"):
        return None
    for upd in reversed(res.get("result", [])):
        msg = upd.get("message") or upd.get("callback_query", {}).get("message")
        if msg and msg.get("chat", {}).get("id") is not None:
            return str(msg["chat"]["id"])
    return None


def _send_approval_message(token: str, chat_id: str, action_desc: str, risk: str, req_id: str) -> int:
    text = (
        f"🛑 Approval required\n"
        f"Risk: {risk.upper()}\n"
        f"Action: {action_desc}\n\n"
        f"Request ID: {req_id}\n"
        f"Choose Approve or Reject."
    )
    payload = {
        "chat_id": chat_id,
        "text": text,
        "reply_markup": {
            "inline_keyboard": [[
                {"text": "✅ Approve", "callback_data": f"approve:{req_id}"},
                {"text": "❌ Reject", "callback_data": f"reject:{req_id}"},
            ]]
        },
    }
    res = _http_json(f"https://api.telegram.org/bot{token}/sendMessage", payload)
    if not res.get("ok"):
        raise RuntimeError(f"Telegram sendMessage failed: {res}")
    return int(res["result"]["message_id"])


def _answer_callback(token: str, callback_query_id: str, text: str) -> None:
    payload = {"callback_query_id": callback_query_id, "text": text, "show_alert": False}
    _http_json(f"https://api.telegram.org/bot{token}/answerCallbackQuery", payload)


def _strip_keyboard(token: str, chat_id: str, message_id: int, suffix: str) -> None:
    payload = {
        "chat_id": chat_id,
        "message_id": message_id,
        "reply_markup": {"inline_keyboard": []},
    }
    _http_json(f"https://api.telegram.org/bot{token}/editMessageReplyMarkup", payload)
    if suffix:
        _http_json(
            f"https://api.telegram.org/bot{token}/sendMessage",
            {"chat_id": chat_id, "text": suffix},
        )


def _poll_decision(token: str, req_id: str, timeout_s: int, start_offset: int = 0) -> Tuple[Optional[bool], str, int]:
    deadline = time.time() + timeout_s
    offset = start_offset

    while time.time() < deadline:
        wait = min(25, max(1, int(deadline - time.time())))
        url = f"https://api.telegram.org/bot{token}/getUpdates?timeout={wait}&allowed_updates={urllib.parse.quote(json.dumps(['callback_query']))}"
        if offset:
            url += f"&offset={offset}"

        res = _http_json(url)
        if not res.get("ok"):
            time.sleep(2)
            continue

        for upd in res.get("result", []):
            offset = max(offset, int(upd.get("update_id", 0)) + 1)
            cb = upd.get("callback_query")
            if not cb:
                continue
            data = str(cb.get("data", ""))
            if data == f"approve:{req_id}":
                _answer_callback(token, cb["id"], "Approved")
                return True, "approved", offset
            if data == f"reject:{req_id}":
                _answer_callback(token, cb["id"], "Rejected")
                return False, "rejected", offset

    return None, "timeout", offset


def is_high_risk(action_desc: str, risk: str) -> bool:
    r = (risk or "").strip().lower()
    if r in {"high", "critical", "p1"}:
        return True
    low = (action_desc or "").strip().lower()
    return any(k in low for k in HIGH_RISK_KEYWORDS)


def request_approval(
    action_desc: str,
    risk: str,
    timeout_s: int = 300,
    chat_id: Optional[str] = None,
    token: Optional[str] = None,
    config_path: str = DEFAULT_CONFIG,
) -> ApprovalResult:
    if not is_high_risk(action_desc, risk):
        return ApprovalResult(approved=True, reason="not_high_risk")

    token = token or _telegram_token(config_path)
    chat_id = chat_id or os.getenv("TELEGRAM_CHAT_ID") or _infer_chat_id(token)
    if not chat_id:
        return ApprovalResult(approved=False, reason="no_chat_id")

    req_id = uuid4().hex[:12]
    msg_id = _send_approval_message(token, chat_id, action_desc, risk, req_id)
    decided, reason, _ = _poll_decision(token, req_id, timeout_s)

    if decided is True:
        _strip_keyboard(token, chat_id, msg_id, f"✅ Approved: {action_desc}")
        return ApprovalResult(approved=True, reason="approved")

    if decided is False:
        _strip_keyboard(token, chat_id, msg_id, f"❌ Rejected: {action_desc}")
        return ApprovalResult(approved=False, reason="rejected")

    _strip_keyboard(token, chat_id, msg_id, f"⏱️ Approval timed out: {action_desc}")
    return ApprovalResult(approved=False, reason="timeout")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", required=True, help="Action description")
    ap.add_argument("--risk", required=True, help="Risk level (low/medium/high)")
    ap.add_argument("--timeout", type=int, default=300, help="Timeout in seconds (default: 300)")
    ap.add_argument("--chat-id", default=None, help="Telegram chat ID override")
    ap.add_argument("--config", default=DEFAULT_CONFIG)
    args = ap.parse_args()

    result = request_approval(
        action_desc=args.action,
        risk=args.risk,
        timeout_s=args.timeout,
        chat_id=args.chat_id,
        config_path=args.config,
    )

    if result.approved:
        print("APPROVED")
        return 0

    print(f"DENIED ({result.reason})")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
