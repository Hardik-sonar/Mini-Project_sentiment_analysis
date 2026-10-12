"""Local development server. Serves the frontend and exposes POST /analyze-video,
the same contract API Gateway + Lambda will provide later.

Run:  python local_server.py   then open http://localhost:5000
"""
import os

from flask import Flask, Response, request, send_from_directory

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.abspath(os.path.join(HERE, "..", "frontend"))


def load_env(path):
    """Minimal .env loader (no extra dependency). Existing environment wins."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env(os.path.join(HERE, "..", ".env"))

import lambda_function  # noqa: E402  (after env is loaded)

app = Flask(__name__, static_folder=None)


@app.post("/analyze-video")
def analyze_video():
    result = lambda_function.lambda_handler({"body": request.get_data(as_text=True)}, None)
    return Response(result["body"], status=result["statusCode"], mimetype="application/json")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.get("/<path:name>")
def static_files(name):
    return send_from_directory(FRONTEND, name)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=False)
