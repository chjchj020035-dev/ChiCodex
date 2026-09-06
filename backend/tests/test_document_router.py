import tempfile
import unittest
from pathlib import Path

from backend.document_router import DocumentRouter, SQLiteSemanticCache


class _FakeCompletions:
    def __init__(self, answers):
        self.answers = iter(answers)
        self.models = []

    def create(self, *, model, **_kwargs):
        self.models.append(model)
        content = next(self.answers)
        message = type("Message", (), {"content": content})()
        return type("Response", (), {"choices": [type("Choice", (), {"message": message})()]})()


class _FakeClient:
    def __init__(self, answers):
        self.completions = _FakeCompletions(answers)
        self.chat = type("Chat", (), {"completions": self.completions})()


class DocumentRouterTests(unittest.TestCase):
    def test_complex_document_uses_flagship_then_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            client = _FakeClient([
                '{"document_type":"multilingual_invoice","is_clear":true,"requires_deep_extraction":true,"reason":"Two languages"}',
                '{"invoice_number":"A-1","currency":"EUR"}',
            ])
            router = DocumentRouter(
                cache=SQLiteSemanticCache(Path(directory) / "cache.sqlite3"),
                client=client,
                lightweight_model="small",
                flagship_model="large",
            )
            first = router.process(b"Invoice / Facture", "invoice.txt")
            second = router.process(b"Invoice / Facture", "invoice.txt")

        self.assertFalse(first["cache_hit"])
        self.assertEqual(first["model_used"], "large")
        self.assertEqual(first["extraction"]["invoice_number"], "A-1")
        self.assertTrue(second["cache_hit"])
        self.assertEqual(client.completions.models, ["small", "large"])

    def test_plain_document_does_not_use_flagship(self):
        with tempfile.TemporaryDirectory() as directory:
            client = _FakeClient([
                '{"document_type":"plain_text","is_clear":true,"requires_deep_extraction":false,"reason":"Simple note"}',
            ])
            router = DocumentRouter(
                cache=SQLiteSemanticCache(Path(directory) / "cache.sqlite3"),
                client=client,
                lightweight_model="small",
                flagship_model="large",
            )
            result = router.process(b"hello", "note.txt")

        self.assertEqual(result["model_used"], "small")
        self.assertEqual(client.completions.models, ["small"])
        self.assertEqual(result["extraction"]["text"], "hello")


if __name__ == "__main__":
    unittest.main()
