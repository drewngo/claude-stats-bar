"""Totals Claude Code token usage from ~/.claude/projects transcripts.

Prints JSON: {"session": W, "7d": W, "30d": W, "all": W}, each window
{input, output, cacheRead, cacheWrite, cost, requests}. Tokens are summed per
transcript line, as /stats sums them: a response written as several lines (one
per content block) counts once per line. Cost and requests count each API
request once, at API list price. Parsed per-file results are cached by
(size, mtime).
"""
import json
import os
import sys
import time

# $ per MTok: input, output, cache read. Cache writes are 1.25x input (5m), 2x input (1h).
PRICES = {
    "claude-fable": (10.0, 50.0, 0.25),
    "claude-mythos": (10.0, 50.0, 0.25),
    "claude-opus-5-5": (4.0, 20.0, 0.20),
    "claude-opus-5": (5.0, 25.0, 0.50),
    "claude-opus-4-5": (5.0, 25.0, 0.50),
    "claude-opus-4-6": (5.0, 25.0, 0.50),
    "claude-opus-4-7": (5.0, 25.0, 0.50),
    "claude-opus-4-8": (5.0, 25.0, 0.50),
    "claude-opus-4": (15.0, 75.0, 1.50),
    "claude-sonnet-5": (2.0, 10.0, 0.20),
    "claude-sonnet-4-6": (3.0, 15.0, 0.30),
    "claude-sonnet": (3.0, 15.0, 0.30),
    "claude-haiku-5": (0.10, 0.50, 0.01),
    "claude-haiku-4-5": (1.0, 5.0, 0.10),
    "claude-haiku": (0.80, 4.0, 0.08),
}
CACHE_VERSION = 2


def price(model):
    best = ""
    for prefix in PRICES:
        if model.startswith(prefix) and len(prefix) > len(best):
            best = prefix
    return PRICES.get(best)


def cost_of(model, u, cc):
    p = price(model)
    if p is None:
        return 0.0
    inp, out, read = p
    w1h = (cc or {}).get("ephemeral_1h_input_tokens", 0) or 0
    w5m = (u.get("cache_creation_input_tokens", 0) or 0) - w1h
    return (
        (u.get("input_tokens", 0) or 0) * inp
        + (u.get("output_tokens", 0) or 0) * out
        + (u.get("cache_read_input_tokens", 0) or 0) * read
        + max(w5m, 0) * inp * 1.25
        + w1h * inp * 2.0
    ) / 1e6


def parse(path):
    """One row per API request: [key, epoch_s, sessionId, in, out, read, write, cost, lines]."""
    rows = {}
    with open(path, "rb") as f:
        for line in f:
            if b'"usage"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            m = d.get("message")
            if not isinstance(m, dict) or not isinstance(m.get("usage"), dict):
                continue
            model = m.get("model", "")
            if model == "<synthetic>":
                continue
            u = m["usage"]
            key = f'{m.get("id")}:{d.get("requestId")}'
            ts = d.get("timestamp", "")
            try:
                t = time.mktime(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
            except ValueError:
                t = 0
            # Streaming writes one line per content block with the same usage.
            lines = rows[key][8] + 1 if key in rows else 1
            rows[key] = [
                key, t, d.get("sessionId", ""),
                u.get("input_tokens", 0) or 0,
                u.get("output_tokens", 0) or 0,
                u.get("cache_read_input_tokens", 0) or 0,
                u.get("cache_creation_input_tokens", 0) or 0,
                cost_of(model, u, u.get("cache_creation")),
                lines,
            ]
    return list(rows.values())


def main():
    root = os.path.expanduser("~/.claude/projects")
    session = sys.argv[1] if len(sys.argv) > 1 else ""
    cache_path = sys.argv[2] if len(sys.argv) > 2 else ""
    cache = {}
    if cache_path:
        try:
            with open(cache_path) as f:
                c = json.load(f)
            if c.get("v") == CACHE_VERSION:
                cache = c["files"]
        except (OSError, ValueError, KeyError):
            pass

    fresh = {}
    for dirpath, _, names in os.walk(root):
        for name in names:
            if not name.endswith(".jsonl"):
                continue
            p = os.path.join(dirpath, name)
            try:
                st = os.stat(p)
            except OSError:
                continue
            sig = [st.st_size, st.st_mtime]
            hit = cache.get(p)
            fresh[p] = hit if hit and hit["sig"] == sig else {"sig": sig, "rows": parse(p)}

    if cache_path:
        tmp = cache_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"v": CACHE_VERSION, "files": fresh}, f)
        os.replace(tmp, cache_path)

    now = time.time()
    windows = {"session": None, "7d": now - 7 * 86400, "30d": now - 30 * 86400, "all": 0}
    out = {k: dict(input=0, output=0, cacheRead=0, cacheWrite=0, cost=0.0, requests=0) for k in windows}
    seen = set()
    for entry in fresh.values():
        for key, t, sid, i, o, r, w, c, lines in entry["rows"]:
            # Resumed sessions can copy earlier lines into a new file: tokens count
            # them again, as /stats does, but the request is billed once.
            is_new = key not in seen
            seen.add(key)
            for name, since in windows.items():
                if since is None and sid != session:
                    continue
                if since is not None and t < since:
                    continue
                win = out[name]
                win["input"] += i * lines
                win["output"] += o * lines
                win["cacheRead"] += r * lines
                win["cacheWrite"] += w * lines
                if is_new:
                    win["cost"] += c
                    win["requests"] += 1
    json.dump(out, sys.stdout)


main()
