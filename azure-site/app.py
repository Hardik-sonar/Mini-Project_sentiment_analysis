"""Static host for the SocialPulse frontend on Azure App Service.

Serves ./static (a copy of ../frontend). It holds NO secrets and does no analysis;
the browser calls API Gateway directly (see static/config.js).
"""
import os

from flask import Flask, send_from_directory

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app = Flask(__name__, static_folder=None)


@app.after_request
def add_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/<path:name>")
def files(name):
    return send_from_directory(STATIC, name)


if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", 8000)))
