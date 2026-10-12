"""Offline tests (no network). Run from backend/:  python -m unittest discover -s tests -v"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import lambda_function  # noqa: E402
import sentiment_provider  # noqa: E402
import youtube_client  # noqa: E402
from sentiment_provider import ProviderError  # noqa: E402
from youtube_client import YouTubeError  # noqa: E402


class UrlTests(unittest.TestCase):
    def test_valid_forms(self):
        for url in [
            "https://www.youtube.com/watch?v=CL1EFACsWag",
            "https://youtu.be/CL1EFACsWag?t=3",
            "https://www.youtube.com/shorts/CL1EFACsWag",
            "https://www.youtube.com/embed/CL1EFACsWag",
            "youtube.com/watch?v=CL1EFACsWag&list=x",
        ]:
            self.assertEqual(youtube_client.extract_video_id(url), "CL1EFACsWag")

    def test_invalid(self):
        for url in ["", "   ", "hello", "https://example.com/watch?v=CL1EFACsWag",
                    "https://www.youtube.com/watch?v=short", "https://www.youtube.com/"]:
            with self.assertRaises(YouTubeError):
                youtube_client.extract_video_id(url)


class ParseTests(unittest.TestCase):
    def test_labels(self):
        self.assertEqual(sentiment_provider.parse_label("POSITIVE."), "POSITIVE")
        self.assertEqual(sentiment_provider.parse_label(" neutral\n"), "NEUTRAL")
        with self.assertRaises(ProviderError):
            sentiment_provider.parse_label("I am not sure")
        with self.assertRaises(ProviderError):
            sentiment_provider.parse_label(None)


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        env = {"STORAGE_MODE": "local", "LOCAL_STORAGE_DIR": self.tmp.name,
               "YOUTUBE_API_KEY": "x", "WORKERS": "4"}
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def call(self, body):
        res = lambda_function.lambda_handler({"body": json.dumps(body)})
        return res["statusCode"], json.loads(res["body"])

    def test_failures_not_counted_as_neutral(self):
        comments = [{"comment_id": str(i), "text": t} for i, t in
                    enumerate(["good", "bad", "meh", "boom"])]

        def fake(text, deadline=None):
            if text == "boom":
                raise ProviderError("PROVIDER_BUSY", "x")
            return {"sentiment": {"good": "POSITIVE", "bad": "NEGATIVE", "meh": "NEUTRAL"}[text]}

        with mock.patch.object(youtube_client, "fetch_comments", return_value=comments), \
             mock.patch.object(sentiment_provider, "analyze", side_effect=fake):
            status, data = self.call({"url": "https://youtu.be/CL1EFACsWag"})
        self.assertEqual(status, 200)
        s = data["summary"]
        self.assertEqual((s["retrieved"], s["analyzed"], s["failed"]), (4, 3, 1))
        self.assertEqual(s["counts"], {"positive": 1, "negative": 1, "neutral": 1})
        self.assertAlmostEqual(s["percentages"]["positive"], 33.3)
        failed = [c for c in data["comments"] if c["status"] == "FAILED"][0]
        self.assertIsNone(failed["sentiment"])
        self.assertTrue(data["storage"]["saved"])

    def test_comments_disabled(self):
        err = YouTubeError("COMMENTS_DISABLED", "off", 422)
        with mock.patch.object(youtube_client, "fetch_comments", side_effect=err):
            status, data = self.call({"url": "https://youtu.be/CL1EFACsWag"})
        self.assertEqual((status, data["error"]["code"]), (422, "COMMENTS_DISABLED"))

    def test_bad_input_and_cap(self):
        self.assertEqual(self.call({"url": ""})[0], 400)
        self.assertEqual(self.call({"url": "https://example.com"})[1]["error"]["code"], "INVALID_URL")
        self.assertEqual(lambda_function._max_comments(5000), 200)
        self.assertEqual(lambda_function._max_comments(0), 1)

    def test_all_failed_no_division_by_zero(self):
        s = lambda_function.summarize([{"status": "FAILED", "sentiment": None}])
        self.assertEqual(s["percentages"], {"positive": 0.0, "negative": 0.0, "neutral": 0.0})


if __name__ == "__main__":
    unittest.main()
