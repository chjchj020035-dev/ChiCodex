"""Hash-cached document classification and extraction orchestration."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import zipfile
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Literal, Protocol
from xml.etree import ElementTree


DocumentType = Literal["plain_text", "complex_contract", "multilingual_invoice", "unknown"]
COMPLEX_DOCUMENT_TYPES = frozenset({"complex_contract", "multilingual_invoice"})
MAX_MODEL_TEXT_CHARS = 30_000
MAX_DOCUMENT_BYTES = 100 * 1024 * 1024


class CacheBackend(Protocol):
    def get(self, key: str) -> dict[str, Any] | None: ...

    def set(self, key: str, value: dict[str, Any]) -> None: ...


class SQLiteSemanticCache:
    """A persistent content-addressed cache for document analysis JSON."""

    def __init__(self, path: str | Path | None = None) -> None:
        configured_path = path or os.getenv("SEMANTIC_CACHE_SQLITE_PATH", "./data/semantic_cache.sqlite3")
        self.path = Path(configured_path).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._connection() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS semantic_cache (
                    document_hash TEXT PRIMARY KEY,
                    result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def _connection(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=10)

    def get(self, key: str) -> dict[str, Any] | None:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT result_json FROM semantic_cache WHERE document_hash = ?", (key,)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def set(self, key: str, value: dict[str, Any]) -> None:
        serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        with self._lock, self._connection() as connection:
            connection.execute(
                """
                INSERT INTO semantic_cache (document_hash, result_json)
                VALUES (?, ?)
                ON CONFLICT(document_hash) DO UPDATE SET result_json = excluded.result_json,
                                                        created_at = CURRENT_TIMESTAMP
                """,
                (key, serialized),
            )


class RedisSemanticCache:
    """Optional Redis cache. Select with SEMANTIC_CACHE_BACKEND=redis."""

    def __init__(self, url: str | None = None, prefix: str = "document-router:") -> None:
        try:
            import redis
        except ImportError as exc:
            raise RuntimeError("redis package is required for the Redis semantic cache") from exc
        self._client = redis.Redis.from_url(url or os.getenv("REDIS_URL", "redis://localhost:6379/0"))
        self._prefix = prefix

    def get(self, key: str) -> dict[str, Any] | None:
        value = self._client.get(f"{self._prefix}{key}")
        return json.loads(value) if value else None

    def set(self, key: str, value: dict[str, Any]) -> None:
        self._client.set(f"{self._prefix}{key}", json.dumps(value, ensure_ascii=False))


def create_semantic_cache() -> CacheBackend:
    if os.getenv("SEMANTIC_CACHE_BACKEND", "sqlite").lower() == "redis":
        return RedisSemanticCache()
    return SQLiteSemanticCache()


@dataclass(frozen=True)
class DocumentClassification:
    document_type: DocumentType
    is_clear: bool
    requires_deep_extraction: bool
    reason: str


class DocumentRouter:
    """Route documents through a cheap classifier before deep model extraction."""

    def __init__(
        self,
        *,
        cache: CacheBackend | None = None,
        client: Any | None = None,
        lightweight_model: str | None = None,
        flagship_model: str | None = None,
    ) -> None:
        self.cache = cache or create_semantic_cache()
        self.client = client
        self.lightweight_model = lightweight_model or os.getenv("DOCUMENT_LIGHTWEIGHT_MODEL", "gpt-4o-mini")
        self.flagship_model = flagship_model or os.getenv("DOCUMENT_FLAGSHIP_MODEL", "gpt-6-astra")

    def process(self, content: bytes, filename: str) -> dict[str, Any]:
        if not content:
            raise ValueError("document must not be empty")
        if len(content) > MAX_DOCUMENT_BYTES:
            raise ValueError("document exceeds the 100 MB size limit")
        document_hash = hashlib.sha256(content).hexdigest()
        cached = self.cache.get(document_hash)
        if cached is not None:
            return {**cached, "cache_hit": True}

        text = extract_document_text(content, filename)
        classification = self._classify(text, filename)
        requires_deep_extraction = (
            classification.is_clear
            and classification.requires_deep_extraction
            and classification.document_type in COMPLEX_DOCUMENT_TYPES
        )
        if requires_deep_extraction:
            extraction = self._deep_extract(text, filename, classification)
            model_used = self.flagship_model
        else:
            extraction = self._basic_extract(text, classification)
            model_used = self.lightweight_model

        result = {
            "document_hash": document_hash,
            "cache_hit": False,
            "classification": asdict(classification),
            "model_used": model_used,
            "extraction": extraction,
        }
        self.cache.set(document_hash, result)
        return result

    def _client(self) -> Any:
        if self.client is not None:
            return self.client
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError("openai package is not installed") from exc
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        self.client = OpenAI(api_key=api_key)
        return self.client

    def _classify(self, text: str, filename: str) -> DocumentClassification:
        payload = self._model_json(
            model=self.lightweight_model,
            system=(
                "Classify a document for routing. Return JSON only with document_type, is_clear, "
                "requires_deep_extraction, and reason. document_type must be plain_text, "
                "complex_contract, multilingual_invoice, or unknown. Set requires_deep_extraction "
                "true only for complex_contract or multilingual_invoice when information must be "
                "reconstructed across languages or a complex structure. Mark unreadable or empty "
                "content is_clear false. Do not extract data."
            ),
            user=self._document_prompt(text, filename),
        )
        document_type = payload.get("document_type", "unknown")
        if document_type not in {"plain_text", "complex_contract", "multilingual_invoice", "unknown"}:
            document_type = "unknown"
        return DocumentClassification(
            document_type=document_type,
            is_clear=bool(payload.get("is_clear", False)),
            requires_deep_extraction=bool(payload.get("requires_deep_extraction", False)),
            reason=str(payload.get("reason", "No reason supplied"))[:500],
        )

    def _deep_extract(
        self, text: str, filename: str, classification: DocumentClassification
    ) -> dict[str, Any]:
        return self._model_json(
            model=self.flagship_model,
            system=(
                "Extract document information into a JSON object. Preserve source languages, "
                "normalize repeated fields into arrays, and report uncertain values in warnings. "
                "For contracts extract parties, dates, obligations, amounts, governing law, and clauses. "
                "For invoices extract supplier, buyer, invoice number, dates, currency, totals, taxes, and line_items."
            ),
            user=(f"Classification: {classification.document_type}\n" + self._document_prompt(text, filename)),
        )

    def _basic_extract(self, text: str, classification: DocumentClassification) -> dict[str, Any]:
        return {
            "status": "ready" if classification.is_clear else "needs_review",
            "text": text,
            "warnings": [] if classification.is_clear else ["Document text could not be read clearly."],
        }

    def _model_json(self, *, model: str, system: str, user: str) -> dict[str, Any]:
        response = self._client().chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_object"},
            temperature=0,
        )
        content = response.choices[0].message.content
        if not content:
            raise RuntimeError("model returned no JSON content")
        try:
            payload = json.loads(content)
        except json.JSONDecodeError as exc:
            raise RuntimeError("model returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("model JSON result must be an object")
        return payload

    @staticmethod
    def _document_prompt(text: str, filename: str) -> str:
        return f"Filename: {filename}\nExtracted text:\n{text[:MAX_MODEL_TEXT_CHARS]}"


def extract_document_text(content: bytes, filename: str) -> str:
    """Extract bounded text from common document formats without executing document content."""

    suffix = Path(filename).suffix.lower()
    if suffix in {".txt", ".md", ".csv", ".json", ".xml"}:
        return content.decode("utf-8", errors="replace")[:MAX_MODEL_TEXT_CHARS]
    if suffix == ".pdf":
        try:
            import fitz
        except ImportError as exc:
            raise RuntimeError("PyMuPDF is required to read PDF text") from exc
        with fitz.open(stream=content, filetype="pdf") as document:
            return "\n".join(page.get_text() for page in document)[:MAX_MODEL_TEXT_CHARS]
    if suffix in {".docx", ".pptx"}:
        try:
            with zipfile.ZipFile(BytesIO(content)) as archive:
                xml_members = (
                    ["word/document.xml"]
                    if suffix == ".docx"
                    else sorted(
                        name
                        for name in archive.namelist()
                        if name.startswith("ppt/slides/slide") and name.endswith(".xml")
                    )
                )
                text_parts: list[str] = []
                for xml_member in xml_members:
                    root = ElementTree.fromstring(archive.read(xml_member))
                    text_parts.extend(node.text or "" for node in root.iter() if node.tag.endswith("}t"))
                return "\n".join(text_parts)[:MAX_MODEL_TEXT_CHARS]
        except (KeyError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
            raise ValueError(f"invalid {suffix[1:].upper()} document") from exc
    raise ValueError("unsupported document type; use PDF, DOCX, PPTX, TXT, MD, CSV, JSON, or XML")


__all__ = [
    "CacheBackend", "DocumentClassification", "DocumentRouter", "RedisSemanticCache",
    "SQLiteSemanticCache", "create_semantic_cache", "extract_document_text", "MAX_DOCUMENT_BYTES",
]
