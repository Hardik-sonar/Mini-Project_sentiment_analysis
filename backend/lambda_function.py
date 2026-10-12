"""Orchestrator. Works as an AWS Lambda handler (API Gateway HTTP API) and locally via local_server.py."""
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import sentiment_provider
import storage
import youtube_client
from sentiment_provider import ProviderError
from youtube_client import YouTubeError

HARD_MAX = 200


def _response(status, payload):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
        "body": json.dumps(payload, ensure_ascii=False),
    }


def _error(status, code, message):
    return _response(status, {"error": {"code": code, "message": message}})


def _max_comments(requested):
    configured = int(os.environ.get("MAX_COMMENTS", HARD_MAX))
    limit = max(1, min(configured, HARD_MAX))
    try:
        value = int(requested) if requested is not None else limit
    except (TypeError, ValueError):
        value = limit
    return max(1, min(value, limit))


def _analyze_one(comment, deadline):
    result = {"comment_id": comment["comment_id"], "text": comment["text"]}
    try:
        out = sentiment_provider.analyze(comment["text"], deadline)
        result.update(status="ANALYZED", sentiment=out["sentiment"])
    except ProviderError as exc:
        result.update(status="FAILED", sentiment=None, error=exc.code)
    except Exception:
        result.update(status="FAILED", sentiment=None, error="UNEXPECTED")
    return result


def summarize(results):
    counts = {"positive": 0, "negative": 0, "neutral": 0}
    analyzed = failed = 0
    for r in results:
        if r["status"] == "ANALYZED":
            analyzed += 1
            counts[r["sentiment"].lower()] += 1
        else:
            failed += 1
    pct = {k: (round(v * 100 / analyzed, 1) if analyzed else 0.0) for k, v in counts.items()}
    return {"retrieved": len(results), "analyzed": analyzed, "failed": failed,
            "counts": counts, "percentages": pct}


def lambda_handler(event, context=None):
    event = event or {}
    if (event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS"):
        return _response(204, {})
    try:
        body = event.get("body", event)
        if isinstance(body, str):
            body = json.loads(body or "{}")
        if not isinstance(body, dict):
            raise ValueError
    except ValueError:
        return _error(400, "BAD_REQUEST", "Request body must be valid JSON.")

    try:
        video_id = youtube_client.extract_video_id(body.get("url"))
        limit = _max_comments(body.get("max_comments"))
        comments = youtube_client.fetch_comments(video_id, limit, os.environ.get("YOUTUBE_API_KEY"))
    except YouTubeError as exc:
        return _error(exc.status, exc.code, exc.message)

    if not comments:
        return _error(404, "NO_COMMENTS", "This video has no comments to analyse.")

    budget = float(os.environ.get("BUDGET_SECONDS", 24))
    deadline = time.time() + budget
    workers = int(os.environ.get("WORKERS", 8))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda c: _analyze_one(c, deadline), comments))

    now = datetime.now(timezone.utc)
    run = {
        "run_id": now.strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:8],
        "created_at": now.isoformat(timespec="seconds"),
        "video": {"id": video_id, "url": f"https://www.youtube.com/watch?v={video_id}"},
        "settings": {"max_comments": limit, "provider": "cloudflare-workers-ai",
                     "model": sentiment_provider.model_name()},
        "summary": summarize(results),
        "comments": results,
    }
    stored = storage.save_run(run)
    return _response(200, {**run, "storage": stored})
