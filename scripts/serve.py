#!/usr/bin/env python3
"""Local preview server for icepop.org.

Identical to `python3 -m http.server` but sends no-cache headers, so edited
CSS/JS always reloads instead of being served stale from the browser cache.
Serves the repo root regardless of where it's launched from.

    python3 scripts/serve.py [port]   # default port 8000
"""

import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(REPO_ROOT)
    print(f"Serving {REPO_ROOT} at http://localhost:{port}/ (caching disabled)")
    try:
        HTTPServer(("", port), NoCacheHandler).serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
