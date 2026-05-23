#!/usr/bin/env python3
"""
Extract visible text from OpenRouter JSON exports and saved Fusion HTML pages.

Default behavior omits JSON reasoning traces and writes:
- inventory.md
- extracted_visible_content.md
- extracted_visible_content.jsonl

Usage:
  python openrouter_extract.py --input-dir /path/to/exports --out-dir ./openrouter_extract
"""
from __future__ import annotations

import argparse, json, re, datetime
from pathlib import Path
from bs4 import BeautifulSoup

def as_list(x):
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        return list(x.values())
    return []

def content_to_text(content):
    parts = []
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict):
                t = c.get("text") or c.get("content") or ""
                if isinstance(t, str):
                    parts.append(t)
            elif isinstance(c, str):
                parts.append(c)
    elif isinstance(content, str):
        parts.append(content)
    return "\n".join(parts).strip()

def extract_json(path: Path, include_reasoning: bool):
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    entries, inventory = [], []
    for ri, room in enumerate(data.get("rooms", [])):
        items = as_list(room.get("items"))
        messages = as_list(room.get("messages"))
        inventory.append({
            "source_type": "json_room",
            "source_file": path.name,
            "room_index": ri,
            "title": room.get("title", ""),
            "messages": len(messages),
            "items": len(items),
            "characters": len(room.get("characters", {}) or {}),
        })
        for ii, item in enumerate(items):
            d = item.get("data", {})
            dtype = d.get("type")
            if dtype == "reasoning" and not include_reasoning:
                continue
            text = content_to_text(d.get("content"))
            if text:
                entries.append({
                    "source_type": "json_room",
                    "source_file": path.name,
                    "room_index": ri,
                    "room_title": room.get("title", ""),
                    "item_index": ii,
                    "role": d.get("role") or dtype,
                    "type": dtype,
                    "message_id": item.get("messageId"),
                    "item_id": item.get("id"),
                    "chars": len(text),
                    "text": text,
                })
    return entries, inventory

def extract_html(path: Path):
    raw = path.read_text(encoding="utf-8", errors="replace")
    url_match = re.search(r"saved from url=\(\d+\)(https://openrouter\.ai/fusion/\d+)", raw)
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    lines = [l.strip() for l in soup.get_text("\n").splitlines() if l.strip()]
    start = 0
    for i, line in enumerate(lines):
        if line == "Prompt":
            start = max(0, i - 3)
            break
    chrome = {
        "Skip to content", "OpenRouter", "Home", "Models", "Fusion", "Chat",
        "Rankings", "Apps", "Enterprise", "Login", "Sign up", "Docs", "Status",
        "Privacy", "Terms",
    }
    kept = [l for l in lines[start:] if l not in chrome]
    text = "\n".join(kept).strip()
    has_responses = ("All Model Responses" in text) or (re.search(r"\bComplete \(\d+ tokens", text) is not None)
    return {
        "source_type": "html_fusion",
        "source_file": path.name,
        "url": url_match.group(1) if url_match else None,
        "line_count": len(lines),
        "has_visible_model_responses": bool(has_responses),
        "chars": len(text),
        "text": text,
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-dir", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--include-reasoning", action="store_true", help="Include exported reasoning traces from JSON. Off by default.")
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    json_entries, json_inv, html_entries = [], [], []
    for path in sorted(args.input_dir.glob("*.json")):
        e, inv = extract_json(path, args.include_reasoning)
        json_entries.extend(e)
        json_inv.extend(inv)
    for path in sorted(list(args.input_dir.glob("*.html")) + list(args.input_dir.glob("*.htm"))):
        html_entries.append(extract_html(path))

    with (args.out_dir / "extracted_visible_content.jsonl").open("w", encoding="utf-8") as f:
        for e in json_entries + html_entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")

    inv_lines = ["# OpenRouter Export Inventory", "", f"Generated: {datetime.datetime.now().isoformat(timespec='seconds')}", ""]
    inv_lines += ["## JSON rooms", "", "| # | title | messages | items | characters |", "|---:|---|---:|---:|---:|"]
    for r in json_inv:
        inv_lines.append(f"| {r['room_index']} | {r['title'].replace('|','/')} | {r['messages']} | {r['items']} | {r['characters']} |")
    inv_lines += ["", "## Fusion HTML captures", "", "| file | URL | visible responses? | lines | chars |", "|---|---|---:|---:|---:|"]
    for h in html_entries:
        inv_lines.append(f"| {h['source_file'].replace('|','/')} | {h.get('url') or ''} | {h['has_visible_model_responses']} | {h['line_count']} | {h['chars']} |")
    (args.out_dir / "inventory.md").write_text("\n".join(inv_lines), encoding="utf-8")

    md = ["# Extracted Visible OpenRouter/Fusion Content", "", "JSON reasoning traces are omitted unless `--include-reasoning` is passed.", ""]
    for e in json_entries:
        md += [f"\n---\n\n## JSON room {e['room_index']}: {e['room_title']}", f"- role: `{e['role']}`", "", e["text"], ""]
    for e in html_entries:
        md += [f"\n---\n\n## Fusion HTML: {e['source_file']}", f"- URL: {e.get('url') or 'unknown'}", f"- visible model responses: `{e['has_visible_model_responses']}`", "", e["text"], ""]
    (args.out_dir / "extracted_visible_content.md").write_text("\n".join(md), encoding="utf-8")

if __name__ == "__main__":
    main()
