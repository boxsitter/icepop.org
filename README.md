# icepop.org

A set of stateless web tools for summer camp management. Intended for use by YMCA Camp Colman
and pretty much useless for anyone else.

Everything runs client-side — no server, no accounts, no data leaves the browser — and is hosted
as static files on GitHub Pages.

## Tools

- **Lantern Counter** (`tools/lantern-counter/`) — counts each camper's distinct valid summers
  from a roster CSV to find who qualifies as a lantern (5+ years).

## Structure

```
index.html      homepage (links to each tool)
assets/         shared design tokens, base styles, and JS utilities
tools/<name>/   one self-contained tool per folder
```

## Local preview

The tools use native ES module imports, which browsers block over `file://`, so serve over http:

```
python3 -m http.server 8000   # from the repo root, then open http://localhost:8000/
```

See `CLAUDE.md` for how the project is organized and how to add a tool.
