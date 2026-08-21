#!/usr/bin/env python3

"""Loopback-only static server with the browser release cache contract."""

from __future__ import annotations

import argparse
import ipaddress
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


HASH_RE = re.compile(r"^[0-9a-f]{64}$")


class ReleaseCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        request = urlsplit(self.path)
        filename = request.path.rstrip("/").rsplit("/", 1)[-1]
        resource_hash = parse_qs(request.query).get("h", [""])[-1]
        if request.path.endswith("/") or filename in {"index.html", "release.json"}:
            cache_control = "no-cache, no-store, must-revalidate"
        elif HASH_RE.fullmatch(resource_hash):
            cache_control = "public, max-age=31536000, immutable"
        else:
            cache_control = "no-cache"
        self.send_header("Cache-Control", cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--bind", default="127.0.0.1")
    arguments = parser.parse_args()
    if not 1024 <= arguments.port <= 65535:
        parser.error("--port must be between 1024 and 65535")
    try:
        parsed_bind_address = ipaddress.ip_address(arguments.bind)
    except ValueError:
        parser.error("--bind must be an IPv4 address")
    if parsed_bind_address.version != 4:
        parser.error("--bind must be an IPv4 address")
    bind_address = str(parsed_bind_address)

    handler = lambda *args, **kwargs: ReleaseCacheHandler(  # noqa: E731
        *args, directory=arguments.directory, **kwargs
    )
    server = ThreadingHTTPServer((bind_address, arguments.port), handler)
    print(f"Serving Ashamane Lab on http://{bind_address}:{arguments.port}/demo/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
