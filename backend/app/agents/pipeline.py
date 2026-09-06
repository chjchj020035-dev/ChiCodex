"""Serial Multi-AgentSwarm for zipped document pages.

The orchestration is deliberately dependency-light. Each agent has one job and
returns JSON-serializable data; the CEO/Swarm composes those results without
letting model output execute code or control the next callable.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Literal, Mapping, Sequence

from ...document_router import CacheBackend, create_semantic_cache


PageType = Literal["order", "invoice", "contract", "receipt", "other"]
SUPPORTED_IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
MAX_PAGES = 500
MAX_IMAGE_BYTES = 20 * 1024 * 1024


@dataclass(frozen=True)
class BoundingBox:
    """Pixel coordinates in the original page image."""

    x: float
    y: float
    width: float
    height: float

    def normalized(self) -> "BoundingBox":
        if self.x < 0 or self.y < 0 or self.width < 0 or self.height < 0:
            raise ValueError("bounding box coordinates must be non-negative")
        return self


@dataclass(frozen=True)
class PageClassification:
    page_number: int
    page_type: PageType
    language: str
    is_clear: bool
    reason: str = ""


@dataclass(frozen=True)
class PageInput:
    page_number: int
    filename: str
    content: bytes
    media_type: str


def _json_response(response: Any) -> dict[str, Any]:
    choices = getattr(response, "choices", None) or []
    if not choices or not getattr(choices[0], "message", None):
        raise RuntimeError("model returned no message")
    content = choices[0].message.content
    if not content:
        raise RuntimeError("model returned empty content")
    try:
        value = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError("model returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise RuntimeError("model JSON must be an object")
    return value


class ModelAgent:
    def __init__(self, *, client: Any | None = None, model: str) -> None:
        self.client = client
        self.model = model

    def _client(self) -> Any:
        if self.client is not None:
            return self.client
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError("openai package is not installed") from exc
        key = os.getenv("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        self.client = OpenAI(api_key=key)
        return self.client

    def _complete(self, *, system: str, user: str, image: PageInput | None = None) -> dict[str, Any]:
        content: list[dict[str, Any]] = [{"type": "text", "text": user}]
        if image is not None:
            encoded = base64.b64encode(image.content).decode("ascii")
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{image.media_type};base64,{encoded}"},
                }
            )
        response = self._client().chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": content}],
            response_format={"type": "json_object"},
            temperature=0,
        )
        return _json_response(response)


class RouterAgent(ModelAgent):
    """Classify every uploaded page before downstream processing."""

    def run(self, page: PageInput) -> PageClassification:
        result = self._complete(
            system=(
                "You are the Router Agent. Classify one document page. Return JSON only with "
                "page_type (order, invoice, contract, receipt, or other), language, is_clear, and reason."
            ),
            user=f"Page number: {page.page_number}\nFilename: {page.filename}",
            image=page,
        )
        page_type = result.get("page_type", "other")
        if page_type not in {"order", "invoice", "contract", "receipt", "other"}:
            page_type = "other"
        return PageClassification(
            page_number=page.page_number,
            page_type=page_type,
            language=str(result.get("language", "unknown"))[:80],
            is_clear=bool(result.get("is_clear", False)),
            reason=str(result.get("reason", ""))[:500],
        )


class CleanerAgent:
    """Remove small image noise while keeping original dimensions for coordinates."""

    def __init__(self, *, enabled: bool = True) -> None:
        self.enabled = enabled

    def run(self, page: PageInput) -> PageInput:
        if not self.enabled:
            return page
        try:
            from PIL import Image, ImageFilter
        except ImportError:
            return page
        try:
            with Image.open(io.BytesIO(page.content)) as source:
                # Keep the original orientation and dimensions: extraction
                # coordinates must remain valid for the uploaded source image.
                image = source.convert("RGB")
                image = image.filter(ImageFilter.MedianFilter(size=3))
                output = io.BytesIO()
                image.save(output, format="PNG", optimize=True)
                return PageInput(page.page_number, page.filename, output.getvalue(), "image/png")
        except Exception:
            # OCR/model processing can still proceed with the original page.
            return page


class ExtractionAgent(ModelAgent):
    """Extract business fields and a source bounding box for every field."""

    def run(self, page: PageInput, classification: PageClassification) -> dict[str, Any]:
        return self._complete(
            system=(
                "You are the Extraction Agent. Extract core business data from this page. "
                "Return JSON with a fields array. Each item must contain name, value, confidence "
                "and bbox with numeric x,y,width,height pixel coordinates in the ORIGINAL image. "
                "For orders prioritize amount, date, SKU, quantity, currency, order_id. "
                "For invoices prioritize invoice_number, supplier, buyer, amount, date, currency, SKU. "
                "If a value is absent, omit the field. Never invent coordinates."
            ),
            user=(
                f"Page type: {classification.page_type}\nLanguage: {classification.language}\n"
                f"Clear: {classification.is_clear}\nFilename: {page.filename}"
            ),
            image=page,
        )


class FormatAgent:
    """Normalize agent output to the frontend's stable page/field schema."""

    def run(
        self,
        page: PageInput,
        classification: PageClassification,
        extraction: Mapping[str, Any],
    ) -> dict[str, Any]:
        fields: list[dict[str, Any]] = []
        raw_fields = extraction.get("fields", [])
        if isinstance(raw_fields, Mapping):
            raw_fields = [{"name": key, "value": value} for key, value in raw_fields.items()]
        if not isinstance(raw_fields, Sequence) or isinstance(raw_fields, (str, bytes)):
            raw_fields = []
        for item in raw_fields:
            if not isinstance(item, Mapping) or "name" not in item or "value" not in item:
                continue
            box = item.get("bbox")
            if isinstance(box, Mapping):
                try:
                    bbox = BoundingBox(
                        float(box["x"]), float(box["y"]), float(box["width"]), float(box["height"])
                    ).normalized()
                except (KeyError, TypeError, ValueError):
                    continue
            elif isinstance(box, Sequence) and len(box) == 4:
                try:
                    bbox = BoundingBox(*(float(value) for value in box)).normalized()
                except (TypeError, ValueError):
                    continue
            else:
                continue
            fields.append(
                {
                    "name": str(item["name"])[:120],
                    "value": item["value"],
                    "confidence": max(0.0, min(1.0, float(item.get("confidence", 0.0)))),
                    "bounding_box": asdict(bbox),
                }
            )
        return {
            "page_number": page.page_number,
            "source_file": page.filename,
            "classification": asdict(classification),
            "fields": fields,
        }


class MultiAgentSwarm:
    """CEO-controlled serial workflow: Router -> Cleaner -> Extraction -> Format."""

    def __init__(
        self,
        *,
        client: Any | None = None,
        ceo_model: str | None = None,
        cleaner: CleanerAgent | None = None,
    ) -> None:
        # The CEO model is intentionally shared by the model-backed agents so
        # one flagship model can coordinate quality and schema decisions.
        model = ceo_model or os.getenv("DOCUMENT_CEO_MODEL", "gpt-6-astra")
        self.router = RouterAgent(client=client, model=model)
        self.cleaner = cleaner or CleanerAgent()
        self.extraction = ExtractionAgent(client=client, model=model)
        self.formatter = FormatAgent()

    def run(self, pages: Iterable[PageInput]) -> dict[str, Any]:
        formatted_pages: list[dict[str, Any]] = []
        for page in pages:
            classification = self.router.run(page)
            cleaned_page = self.cleaner.run(page)
            extraction = self.extraction.run(cleaned_page, classification)
            formatted_pages.append(self.formatter.run(page, classification, extraction))
        return {"pages": formatted_pages, "page_count": len(formatted_pages), "orchestrator": self.router.model}


class CEOAgent(MultiAgentSwarm):
    """Named CEO facade for integrations that want an explicit orchestrator role."""


def _media_type(path: str) -> str:
    return {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(
        Path(path).suffix.lower(), "image/png"
    )


def load_archive_pages(archive: bytes, *, filename: str = "document.zip") -> list[PageInput]:
    if not archive:
        raise ValueError("archive must not be empty")
    if len(archive) > MAX_ARCHIVE_BYTES:
        raise ValueError("archive exceeds the 100 MB size limit")
    if not filename.lower().endswith(".zip"):
        raise ValueError("upload must be a .zip archive containing page images")
    pages: list[PageInput] = []
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            members = [
                member
                for member in bundle.infolist()
                if not member.is_dir() and Path(member.filename).suffix.lower() in SUPPORTED_IMAGE_TYPES
            ]
            members.sort(key=lambda member: (natural_page_key(member.filename), member.filename.lower()))
            if len(members) > MAX_PAGES:
                raise ValueError(f"archive contains more than {MAX_PAGES} pages")
            total_image_bytes = 0
            for number, member in enumerate(members, start=1):
                if member.file_size > MAX_IMAGE_BYTES:
                    raise ValueError(f"page {member.filename} exceeds the 20 MB size limit")
                total_image_bytes += member.file_size
                if total_image_bytes > MAX_ARCHIVE_BYTES:
                    raise ValueError("uncompressed page data exceeds the 100 MB size limit")
                safe_name = Path(member.filename).name
                pages.append(PageInput(number, safe_name, bundle.read(member), _media_type(safe_name)))
    except zipfile.BadZipFile as exc:
        raise ValueError("invalid ZIP archive") from exc
    if not pages:
        raise ValueError("archive contains no supported page images")
    return pages


def natural_page_key(name: str) -> tuple[Any, ...]:
    return tuple(int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", Path(name).name))


def process_document_pipeline(
    archive: bytes,
    *,
    filename: str = "document.zip",
    client: Any | None = None,
    ceo_model: str | None = None,
    cache: CacheBackend | None = None,
) -> dict[str, Any]:
    """Run all four agents serially and return frontend-ready JSON."""

    archive_hash = hashlib.sha256(archive).hexdigest()
    cache_backend = cache or create_semantic_cache()
    cache_key = f"pipeline:{archive_hash}"
    cached = cache_backend.get(cache_key)
    if cached is not None:
        return {**cached, "cache_hit": True}
    pages = load_archive_pages(archive, filename=filename)
    result = CEOAgent(client=client, ceo_model=ceo_model).run(pages)
    result.update({"document_hash": archive_hash, "cache_hit": False})
    cache_backend.set(cache_key, result)
    return result


__all__ = [
    "BoundingBox", "CEOAgent", "CleanerAgent", "ExtractionAgent", "FormatAgent", "MultiAgentSwarm",
    "PageClassification", "PageInput", "RouterAgent", "load_archive_pages",
    "process_document_pipeline",
]
