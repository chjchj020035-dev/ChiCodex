import io
import json
import tempfile
import unittest
import zipfile

from backend.app.agents import process_document_pipeline


class _MemoryCache:
    def __init__(self):
        self.values = {}

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value):
        self.values[key] = value


class _FakeCompletions:
    def __init__(self):
        self.calls = []

    def create(self, *, model, messages, **_kwargs):
        self.calls.append(model)
        text = messages[1]["content"][0]["text"]
        if "Page type:" not in text:
            value = {"page_type": "order", "language": "en", "is_clear": True, "reason": "clear"}
        else:
            value = {
                "fields": [
                    {"name": "amount", "value": "42.00", "confidence": 0.95, "bbox": {"x": 10, "y": 20, "width": 80, "height": 25}}
                ]
            }
        message = type("Message", (), {"content": json.dumps(value)})()
        choice = type("Choice", (), {"message": message})()
        return type("Response", (), {"choices": [choice]})()


class _FakeClient:
    def __init__(self):
        self.chat = type("Chat", (), {})()
        self.chat.completions = _FakeCompletions()


class AgentPipelineTests(unittest.TestCase):
    def test_pipeline_is_serial_and_returns_bounding_boxes(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("page-2.png", b"second")
            bundle.writestr("page-1.png", b"first")
        client = _FakeClient()
        cache = _MemoryCache()
        result = process_document_pipeline(archive.getvalue(), client=client, ceo_model="gpt-6-astra", cache=cache)
        self.assertEqual(result["page_count"], 2)
        self.assertEqual([page["page_number"] for page in result["pages"]], [1, 2])
        self.assertEqual(result["pages"][0]["fields"][0]["bounding_box"]["x"], 10.0)
        self.assertEqual(client.chat.completions.calls, ["gpt-6-astra"] * 4)
        cached = process_document_pipeline(archive.getvalue(), client=client, ceo_model="gpt-6-astra", cache=cache)
        self.assertTrue(cached["cache_hit"])
        self.assertEqual(client.chat.completions.calls, ["gpt-6-astra"] * 4)


if __name__ == "__main__":
    unittest.main()
