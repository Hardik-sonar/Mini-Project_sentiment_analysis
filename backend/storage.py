"""Result storage. STORAGE_MODE=local writes to ./analyses, STORAGE_MODE=s3 uses a private bucket.

Same key layout in both modes: analyses/YYYY/MM/DD/<run_id>.json
save_run never raises; it reports success or failure so the API can be honest.
"""
import json
import os


def _key(run):
    day = run["created_at"][:10].split("-")  # YYYY-MM-DD
    return f"analyses/{day[0]}/{day[1]}/{day[2]}/{run['run_id']}.json"


def save_run(run):
    mode = os.environ.get("STORAGE_MODE", "local").lower()
    key = _key(run)
    body = json.dumps(run, ensure_ascii=False, indent=2)
    try:
        if mode == "s3":
            import boto3  # available in the Lambda runtime
            bucket = os.environ["BUCKET_NAME"]
            boto3.client("s3").put_object(
                Bucket=bucket, Key=key, Body=body.encode("utf-8"),
                ContentType="application/json", ServerSideEncryption="AES256",
            )
            return {"saved": True, "mode": "s3", "location": f"s3://{bucket}/{key}"}
        root = os.environ.get("LOCAL_STORAGE_DIR", os.path.join(os.path.dirname(__file__), "..", "local_results"))
        path = os.path.abspath(os.path.join(root, key))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(body)
        return {"saved": True, "mode": "local", "location": key}
    except Exception as exc:  # report, never crash the analysis
        return {"saved": False, "mode": mode, "location": None, "error": type(exc).__name__}
