"""Serve site/ for local testing, with caching off so edits show on a normal reload.

    python pipeline/serve.py [port]      # binds 0.0.0.0, default port 8765
"""
import functools
import http.server
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / "site"


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(NoCache, directory=str(SITE))
    print(f"serving {SITE} on http://0.0.0.0:{port}")
    http.server.ThreadingHTTPServer(("0.0.0.0", port), handler).serve_forever()
