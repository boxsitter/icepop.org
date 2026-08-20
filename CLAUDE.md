# icepop.org — project notes for Claude

Stateless web utilities for YMCA Camp Colman. Plain HTML/CSS/JS, **no build step**,
hosted on GitHub Pages.

## Hard rules

- **Stateless & client-side only.** No server, no backend, no auth. Everything runs in the
  browser. Never send camper data over the network or persist it (no localStorage, no uploads).
- **Static files only** — it must work when served as-is by GitHub Pages.
- Routing is folder-based: `icepop.org/tools/<name>/` maps to `tools/<name>/index.html`.

## Layout

```
index.html                # homepage — card grid of tools
assets/css/tokens.css     # design tokens (colors, spacing, fonts) — no hardcoded hex anywhere else
assets/css/base.css       # shared styles: body, main, .panel, .btn/.btn-primary/.btn-secondary, .privacy-note
assets/js/csv.js          # shared ES module: parseCSV, toCSV, csvEscape
assets/js/vendor/         # vendored third-party libs (e.g. mammoth.browser.min.js for docx)
tools/<name>/             # one folder per tool (index.html + app.js + <name>.css)
docs/                     # documents shown by the Document Viewer (+ generated manifest.json)
scripts/gen-docs-manifest.py  # regenerates docs/manifest.json from the docs/ tree
```

## Adding a tool

1. Create `tools/<name>/` with `index.html`, its script, and `<name>.css`.
2. In `index.html`: link `../../assets/css/tokens.css` then `base.css` then your own CSS;
   use `<script type="module" src="app.js">`; import shared JS, e.g.
   `import { parseCSV } from '../../assets/js/csv.js';`. Add a `← All tools` link to `../../`.
3. Add a card for it in the homepage `index.html` (`.tool-grid`).

Style with the tokens (`var(--color-accent)` etc.) and reuse `.btn`/`.panel` — don't hardcode
colors, so every tool stays visually consistent.

## Local preview

`type="module"` imports don't work over `file://`, so serve over http:

```
python3 -m http.server 8000   # from the repo root, then open http://localhost:8000/
```

## Document Viewer & docs

`tools/doc-viewer/` shows the files under `docs/`. Because the site is static (no directory
listing at runtime), navigation is driven by `docs/manifest.json`. **After adding, removing, or
renaming anything in `docs/`, regenerate it:**

```
python3 scripts/gen-docs-manifest.py
```

Supported types: `.pdf` (shown in an iframe) and `.docx` (converted to HTML in the browser by
the vendored `mammoth.browser.min.js` — no CDN, no build). To bump the library, re-download it
into `assets/js/vendor/` and note the version.

## Reference example

`tools/lantern-counter/` is the canonical tool. Its domain logic (what counts as a valid camp
summer, the lantern threshold) is documented in `tools/lantern-counter/RULES.md`.
