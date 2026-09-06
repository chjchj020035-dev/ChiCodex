"""Convert MyAngel chat history into MiniMind conversation JSONL.

Usage:
  python training/prepare_openclaw_dataset.py history.json training/openclaw_sft.jsonl
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: prepare_openclaw_dataset.py HISTORY_JSON OUTPUT_JSONL")
    source, target = map(Path, sys.argv[1:])
    messages = json.loads(source.read_text(encoding="utf-8"))
    rows = []
    for i in range(len(messages) - 1):
        current, following = messages[i], messages[i + 1]
        if current.get("role") != "user" or following.get("role") != "assistant":
            continue
        rows.append({"conversations": [
            {"role": "user", "content": current.get("content", "")},
            {"role": "assistant", "content": following.get("content", "")},
        ]})
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} conversations to {target}")


if __name__ == "__main__":
    main()
