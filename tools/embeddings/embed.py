#!/usr/bin/env python3
"""
Local embedding CLI/service for Apple Silicon Macs.

Uses FastEmbed (ONNXRuntime) with a fully-local model cache.
No API calls after model download.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from fastembed import TextEmbedding


DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"


def _load_texts(args: argparse.Namespace) -> list[str]:
    texts: list[str] = []

    if args.text:
        texts.extend(args.text)

    if args.text_file:
        with open(args.text_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    texts.append(line)

    if args.stdin:
        stdin_data = sys.stdin.read().strip()
        if stdin_data:
            # If stdin has JSON array, parse it; otherwise split by lines.
            if stdin_data.startswith("["):
                try:
                    parsed = json.loads(stdin_data)
                    if isinstance(parsed, list):
                        texts.extend(str(x) for x in parsed if str(x).strip())
                    else:
                        texts.append(str(parsed))
                except json.JSONDecodeError:
                    texts.extend([x for x in stdin_data.splitlines() if x.strip()])
            else:
                texts.extend([x for x in stdin_data.splitlines() if x.strip()])

    if not texts:
        raise SystemExit("No input text provided. Use --text, --text-file, or --stdin.")

    return texts


def _embedder(model_name: str, cache_dir: str | None = None) -> TextEmbedding:
    kwargs: dict[str, Any] = {"model_name": model_name}
    if cache_dir:
        kwargs["cache_dir"] = cache_dir
    return TextEmbedding(**kwargs)


def _embed_texts(embedder: TextEmbedding, texts: list[str]) -> list[list[float]]:
    vectors = list(embedder.embed(texts))
    return [v.tolist() for v in vectors]


def run_embed(args: argparse.Namespace) -> None:
    texts = _load_texts(args)
    embedder = _embedder(args.model, args.cache_dir)
    vectors = _embed_texts(embedder, texts)

    if args.pretty:
        print(json.dumps({"model": args.model, "count": len(vectors), "vectors": vectors}, indent=2))
    else:
        print(json.dumps({"model": args.model, "count": len(vectors), "vectors": vectors}))



def run_benchmark(args: argparse.Namespace) -> None:
    samples = [
        "Local embeddings remove API latency and cost for semantic indexing.",
        "Apple Silicon can run ONNX models efficiently for vector generation.",
        "FastEmbed makes sentence embedding inference simple and production-friendly.",
    ]

    embedder = _embedder(args.model, args.cache_dir)

    # Warm-up pass (loads model into memory, compiles kernels)
    _ = _embed_texts(embedder, samples)

    texts = samples * args.batch_multiplier
    start = time.perf_counter()
    for _ in range(args.runs):
        _ = _embed_texts(embedder, texts)
    elapsed = time.perf_counter() - start

    total_texts = len(texts) * args.runs
    texts_per_sec = total_texts / elapsed if elapsed > 0 else float("inf")

    result = {
        "model": args.model,
        "runs": args.runs,
        "texts_per_run": len(texts),
        "total_texts": total_texts,
        "elapsed_seconds": round(elapsed, 4),
        "texts_per_second": round(texts_per_sec, 2),
    }

    if args.pretty:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(result))


class EmbeddingHandler(BaseHTTPRequestHandler):
    embedder: TextEmbedding | None = None
    model_name: str = DEFAULT_MODEL

    def _json_response(self, status: int, payload: dict[str, Any]) -> None:
        out = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self) -> None:  # noqa: N802 (HTTP method name)
        if self.path == "/health":
            self._json_response(200, {"ok": True, "model": self.model_name})
        else:
            self._json_response(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802 (HTTP method name)
        if self.path != "/embed":
            self._json_response(404, {"error": "not_found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length > 0 else b"{}"

        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self._json_response(400, {"error": "invalid_json"})
            return

        texts = payload.get("texts")
        if not isinstance(texts, list) or not texts:
            self._json_response(400, {"error": "texts must be a non-empty array"})
            return

        assert self.embedder is not None
        vectors = _embed_texts(self.embedder, [str(t) for t in texts])
        self._json_response(200, {"model": self.model_name, "count": len(vectors), "vectors": vectors})


def run_server(args: argparse.Namespace) -> None:
    embedder = _embedder(args.model, args.cache_dir)
    EmbeddingHandler.embedder = embedder
    EmbeddingHandler.model_name = args.model

    server = HTTPServer((args.host, args.port), EmbeddingHandler)
    print(f"Embedding server running on http://{args.host}:{args.port} (model={args.model})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()



def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local embedding factory CLI/service")
    sub = parser.add_subparsers(dest="command", required=True)

    # embed
    p_embed = sub.add_parser("embed", help="Generate embeddings")
    p_embed.add_argument("--text", action="append", help="Input text (repeatable)")
    p_embed.add_argument("--text-file", help="Read one text per line from file")
    p_embed.add_argument("--stdin", action="store_true", help="Read text(s) from stdin")
    p_embed.add_argument("--model", default=DEFAULT_MODEL, help=f"Model name (default: {DEFAULT_MODEL})")
    p_embed.add_argument("--cache-dir", default=os.path.expanduser("~/.cache/local-embeddings"), help="Model cache dir")
    p_embed.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    p_embed.set_defaults(func=run_embed)

    # benchmark
    p_bench = sub.add_parser("benchmark", help="Run local performance benchmark")
    p_bench.add_argument("--model", default=DEFAULT_MODEL, help=f"Model name (default: {DEFAULT_MODEL})")
    p_bench.add_argument("--cache-dir", default=os.path.expanduser("~/.cache/local-embeddings"), help="Model cache dir")
    p_bench.add_argument("--runs", type=int, default=30, help="Number of timed runs")
    p_bench.add_argument("--batch-multiplier", type=int, default=32, help="Repeat sample set to increase batch size")
    p_bench.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    p_bench.set_defaults(func=run_benchmark)

    # serve
    p_srv = sub.add_parser("serve", help="Run a local HTTP embedding service")
    p_srv.add_argument("--host", default="127.0.0.1", help="Bind host")
    p_srv.add_argument("--port", type=int, default=8765, help="Bind port")
    p_srv.add_argument("--model", default=DEFAULT_MODEL, help=f"Model name (default: {DEFAULT_MODEL})")
    p_srv.add_argument("--cache-dir", default=os.path.expanduser("~/.cache/local-embeddings"), help="Model cache dir")
    p_srv.set_defaults(func=run_server)

    return parser


if __name__ == "__main__":
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)
