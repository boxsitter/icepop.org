#!/usr/bin/env python3
"""Generate docs/manifest.json — the index the Document Viewer reads to build
its navigation. The site is static (no directory listing at runtime), so the
folder tree has to be written out ahead of time.

Run this whenever you add, remove, or rename a file under docs/:

    python3 scripts/gen-docs-manifest.py

It walks docs/, keeps only viewable file types, and writes a nested tree of
folders and files sorted alphabetically.
"""

import json
import sys
from datetime import date
from pathlib import Path

VIEWABLE = {".docx", ".pdf"}

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = REPO_ROOT / "docs"
MANIFEST = DOCS_DIR / "manifest.json"


def build_tree(directory: Path) -> list:
    """Return a sorted list of nodes (folders first, then files) for a dir."""
    folders, files = [], []
    for entry in directory.iterdir():
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            children = build_tree(entry)
            if children:  # skip empty folders
                folders.append({"type": "folder", "name": entry.name, "children": children})
        elif entry.suffix.lower() in VIEWABLE:
            files.append({
                "type": "file",
                "name": entry.name,
                "path": entry.relative_to(DOCS_DIR).as_posix(),
                "ext": entry.suffix.lower().lstrip("."),
            })
    folders.sort(key=lambda n: n["name"].lower())
    files.sort(key=lambda n: n["name"].lower())
    return folders + files


def main() -> int:
    if not DOCS_DIR.is_dir():
        print(f"No docs/ directory at {DOCS_DIR}", file=sys.stderr)
        return 1

    tree = build_tree(DOCS_DIR)
    manifest = {"generated": date.today().isoformat(), "tree": tree}
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    file_count = json.dumps(tree).count('"type": "file"')
    print(f"Wrote {MANIFEST.relative_to(REPO_ROOT)} — {file_count} document(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
