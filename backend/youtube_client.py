"""YouTube Data API v3 client: URL parsing and comment retrieval.

Uses only the standard library so the Lambda package stays small.
Only top-level comments are retrieved (commentThreads.list).
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

API_URL = "https://www.googleapis.com/youtube/v3/commentThreads"
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "music.youtube.com", "youtu.be", "www.youtu.be",
}


class YouTubeError(Exception):
    """Error with a stable machine-readable code and an HTTP status."""

    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def extract_video_id(url):
    """Return the 11-character video ID from a YouTube URL, or raise YouTubeError."""
    bad = YouTubeError("INVALID_URL", "Please enter a valid YouTube video URL.", 400)
    if not isinstance(url, str) or not url.strip():
        raise YouTubeError("EMPTY_INPUT", "Please paste a YouTube video URL.", 400)
    raw = url.strip()
    if "://" not in raw:
        raw = "https://" + raw
    try:
        parsed = urllib.parse.urlparse(raw)
        host = (parsed.hostname or "").lower()
    except ValueError:
        raise bad
    if host not in _HOSTS:
        raise bad

    parts = [p for p in parsed.path.split("/") if p]
    video_id = None
    if host.endswith("youtu.be"):
        video_id = parts[0] if parts else None
    elif parts[:1] == ["watch"]:
        video_id = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
    elif len(parts) > 1 and parts[0] in ("shorts", "embed", "live", "v"):
        video_id = parts[1]

    if not video_id or not _ID_RE.match(video_id):
        raise bad
    return video_id


def _map_http_error(status, reason):
    if reason == "commentsDisabled":
        return YouTubeError("COMMENTS_DISABLED", "Comments are disabled for this video.", 422)
    if reason in ("videoNotFound",) or status == 404:
        return YouTubeError("VIDEO_NOT_FOUND", "Video not found, or it is private.", 404)
    if reason in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"):
        return YouTubeError("QUOTA_EXCEEDED", "YouTube API quota exceeded. Try again later.", 429)
    if reason in ("keyInvalid", "accessNotConfigured", "ipRefererBlocked") or status == 400:
        return YouTubeError("SERVER_CONFIG", "YouTube API is not configured correctly on the server.", 502)
    if status == 403:
        return YouTubeError("FORBIDDEN", "YouTube refused access to this video's comments.", 403)
    return YouTubeError("YOUTUBE_ERROR", "YouTube API returned an error.", 502)


def _get(params):
    url = API_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except Exception:
            body = {}
        errors = (body.get("error") or {}).get("errors") or []
        reason = errors[0].get("reason", "") if errors else ""
        raise _map_http_error(exc.code, reason) from None
    except (urllib.error.URLError, TimeoutError):
        raise YouTubeError("YOUTUBE_UNREACHABLE", "Could not reach the YouTube API.", 502) from None


def fetch_comments(video_id, max_comments, api_key):
    """Return up to max_comments top-level comments as a list of dicts."""
    if not api_key:
        raise YouTubeError("SERVER_CONFIG", "YouTube API key is not configured.", 500)
    comments = []
    page_token = None
    while len(comments) < max_comments:
        params = {
            "part": "snippet",
            "videoId": video_id,
            "maxResults": min(100, max_comments - len(comments)),
            "textFormat": "plainText",
            "key": api_key,
        }
        if page_token:
            params["pageToken"] = page_token
        data = _get(params)
        for item in data.get("items", []):
            top = item.get("snippet", {}).get("topLevelComment", {})
            text = top.get("snippet", {}).get("textDisplay", "")
            comments.append({"comment_id": top.get("id") or item.get("id"), "text": text})
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return comments[:max_comments]
