from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class DemoHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def send_head(self):
        del self.headers["If-Modified-Since"]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    handler = partial(DemoHandler, directory=root)
    with ThreadingHTTPServer(("127.0.0.1", 3031), handler) as server:
        print("http://127.0.0.1:3031/examples/sdk-preview/index.html", flush=True)
        server.serve_forever()
