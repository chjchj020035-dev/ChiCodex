"""Translate natural-language requests into a small, fixed tool surface.

Tool arguments are validated by Pydantic before anything reaches the image
pipeline; no model text is ever evaluated as Python.
"""

from __future__ import annotations

import inspect
import json
import os
from enum import Enum
from pathlib import Path
from typing import Any, Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class EraseTarget(str, Enum):
    red_ink = "red_ink"
    blue_ink = "blue_ink"
    handwriting = "handwriting"
    printed_text = "printed_text"
    annotation = "annotation"


class EraseCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: str = Field(pattern="^erase$")
    target: EraseTarget
    # A normalized rectangle is optional. Coordinates stay data, never code.
    region: tuple[float, float, float, float] | None = None

    def normalized(self) -> "EraseCommand":
        if self.region is None:
            return self
        x1, y1, x2, y2 = self.region
        if not all(0 <= value <= 1 for value in self.region) or x1 >= x2 or y1 >= y2:
            raise ValueError("region must be an increasing rectangle in [0, 1]")
        return self


class ReorderPagesCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["reorder_pages"]
    pages: list[int] = Field(min_length=1, max_length=500)

    def normalized(self) -> "ReorderPagesCommand":
        if len(set(self.pages)) != len(self.pages) or any(page < 0 for page in self.pages):
            raise ValueError("pages must contain unique non-negative page ids")
        return self


class OptimizeLayoutCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["optimize_layout"]
    page_id: int = Field(ge=0)


AgentCommand = EraseCommand | ReorderPagesCommand | OptimizeLayoutCommand


ERASE_TOOL = {
    "type": "function",
    "function": {
        "name": "erase",
        "description": "Remove a marked area from the currently selected image.",
        "strict": True,
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "action": {"type": "string", "enum": ["erase"]},
                "target": {
                    "type": "string",
                    "enum": [item.value for item in EraseTarget],
                    "description": "The kind of mark to remove.",
                },
                "region": {
                    "type": ["array", "null"],
                    "items": {"type": "number", "minimum": 0, "maximum": 1},
                    "minItems": 4,
                    "maxItems": 4,
                    "description": "Optional normalized x1,y1,x2,y2 rectangle.",
                },
            },
            "required": ["action", "target", "region"],
        },
    },
}

REORDER_PAGES_TOOL = {
    "type": "function",
    "function": {
        "name": "reorder_pages",
        "description": "Set the order of the document pages using their numeric page ids.",
        "strict": True,
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "action": {"type": "string", "enum": ["reorder_pages"]},
                "pages": {
                    "type": "array",
                    "items": {"type": "integer", "minimum": 0},
                    "minItems": 1,
                    "maxItems": 500,
                    "description": "The complete page id list in the desired order.",
                },
            },
            "required": ["action", "pages"],
        },
    },
}

OPTIMIZE_LAYOUT_TOOL = {
    "type": "function",
    "function": {
        "name": "optimize_layout",
        "description": "Improve one page with the existing perspective crop or contrast enhancement pipeline.",
        "strict": True,
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "action": {"type": "string", "enum": ["optimize_layout"]},
                "page_id": {"type": "integer", "minimum": 0},
            },
            "required": ["action", "page_id"],
        },
    },
}

TOOLS = [ERASE_TOOL, REORDER_PAGES_TOOL, OPTIMIZE_LAYOUT_TOOL]
# Backwards-compatible name for integrations that registered the original tool.
TOOL = ERASE_TOOL

SYSTEM_PROMPT = (
    "You are ClearPage's image editing command router. "
    "Choose exactly one tool call for each user request. "
    "Never invent tools, code, file paths, shell commands, or extra arguments. "
    "Use target=red_ink for red pen/marker writing, blue_ink for blue ink, "
    "handwriting for handwriting, printed_text for printed words, and "
    "annotation for an unspecified annotation. Use reorder_pages when the "
    "user asks to reorder pages, and optimize_layout for one page's perspective "
    "or contrast improvement. Always return one of the registered tools; never "
    "return prose or another action."
)


def _client() -> Any:
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("openai package is not installed") from exc

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return OpenAI(api_key=api_key)


def _decode_tool_call(response: Any) -> AgentCommand:
    choices = getattr(response, "choices", None) or []
    if not choices:
        raise ValueError("model returned no choices")
    message = choices[0].message
    calls = getattr(message, "tool_calls", None) or []
    if len(calls) != 1 or calls[0].function.name not in {"erase", "reorder_pages", "optimize_layout"}:
        raise ValueError("model did not return exactly one registered tool call")
    name = calls[0].function.name
    raw = json.loads(calls[0].function.arguments)
    if name == "erase":
        return EraseCommand.model_validate(raw).normalized()
    if name == "reorder_pages":
        return ReorderPagesCommand.model_validate(raw).normalized()
    return OptimizeLayoutCommand.model_validate(raw)


def translate_text(text: str, *, client: Any | None = None, model: str | None = None) -> AgentCommand:
    """Translate user text into one validated, fixed-shape command."""

    clean = text.strip()
    if not clean or len(clean) > 2000:
        raise ValueError("text must contain between 1 and 2000 characters")
    active_client = client or _client()
    response = active_client.chat.completions.create(
        model=model or os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": clean}],
        tools=TOOLS,
        tool_choice="required",
        parallel_tool_calls=False,
        temperature=0,
    )
    return _decode_tool_call(response)


def resolve_image_path(image_id: str) -> Path:
    """Resolve an image id below the configured upload root, rejecting traversal."""

    if not image_id or Path(image_id).name != image_id:
        raise ValueError("image_id must be a file name")
    root = Path(os.getenv("JOB_ROOT", "./data")).resolve()
    candidate = (root / image_id).resolve()
    if root not in candidate.parents:
        raise ValueError("image_id is outside the image workspace")
    if not candidate.is_file():
        raise FileNotFoundError("selected image was not found")
    return candidate


def _safe_result(result: Any) -> Any:
    if isinstance(result, (str, int, float, bool, type(None), dict, list)):
        return result
    return {"value": str(result)}


def execute_erase(command: EraseCommand, image_id: str | None = None) -> dict[str, Any]:
    """Call the local pipeline's erase function through an inspected, fixed adapter."""

    command = command.normalized()
    if not image_id:
        return {"status": "command_ready", "command": command.model_dump(mode="json")}
    image_path = resolve_image_path(image_id)
    try:
        from .pipeline import erase  # type: ignore
    except (ImportError, AttributeError) as exc:
        raise RuntimeError("ClearPage erase() pipeline is unavailable") from exc

    # Pass only named parameters supported by the existing implementation.
    available = inspect.signature(erase).parameters
    kwargs: dict[str, Any] = {}
    for name, value in (
        ("target", command.target.value),
        ("region", command.region),
        ("image_path", str(image_path)),
        ("input_path", str(image_path)),
        ("file_path", str(image_path)),
        ("path", str(image_path)),
    ):
        if name in available:
            kwargs[name] = value
    if not kwargs:
        raise RuntimeError("erase() has no supported ClearPage adapter signature")
    return {"status": "executed", "command": command.model_dump(mode="json"), "result": _safe_result(erase(**kwargs))}


def reorder_pages(pages: Sequence[int], current_page_ids: Sequence[int]) -> list[int]:
    """Validate and return a complete permutation of the current page ids."""

    command = ReorderPagesCommand(action="reorder_pages", pages=list(pages)).normalized()
    current = list(current_page_ids)
    if len(set(current)) != len(current) or any(page < 0 for page in current):
        raise ValueError("current page ids must be unique non-negative integers")
    if sorted(command.pages) != sorted(current):
        raise ValueError("pages must be a complete permutation of the current page ids")
    return list(command.pages)


def optimize_layout(
    page_id: int,
    image_id: str,
    *,
    page_ids: Sequence[int] | None = None,
) -> Any:
    """Run one of the existing, explicitly allow-listed layout algorithms."""

    command = OptimizeLayoutCommand(action="optimize_layout", page_id=page_id)
    if page_ids is not None and page_id not in page_ids:
        raise ValueError("page_id is not present in the current page array")
    image_path = resolve_image_path(image_id)
    try:
        from . import pipeline  # type: ignore
    except ImportError as exc:
        raise RuntimeError("ClearPage image pipeline is unavailable") from exc

    algorithm = None
    for name in (
        "optimize_layout",
        "perspective_crop",
        "correct_perspective",
        "enhance_contrast",
        "contrast_enhance",
    ):
        candidate = getattr(pipeline, name, None)
        if callable(candidate):
            algorithm = candidate
            break
    if algorithm is None:
        raise RuntimeError("no perspective crop or contrast enhancement algorithm is available")
    available = inspect.signature(algorithm).parameters
    kwargs: dict[str, Any] = {}
    for name, value in (
        ("image_path", str(image_path)),
        ("input_path", str(image_path)),
        ("file_path", str(image_path)),
        ("path", str(image_path)),
        ("page_id", command.page_id),
    ):
        if name in available:
            kwargs[name] = value
    if not kwargs:
        raise RuntimeError("layout optimizer has no supported ClearPage adapter signature")
    return _safe_result(algorithm(**kwargs))


def execute_command(
    command: AgentCommand,
    *,
    image_id: str | None = None,
    page_ids: list[int] | None = None,
) -> dict[str, Any]:
    """Execute a validated command without exposing arbitrary callables."""

    if isinstance(command, EraseCommand):
        return execute_erase(command, image_id)
    if isinstance(command, ReorderPagesCommand):
        command = command.normalized()
        if page_ids is None:
            return {"status": "command_ready", "command": command.model_dump(mode="json")}
        ordered_page_ids = reorder_pages(command.pages, page_ids)
        return {
            "status": "executed",
            "command": command.model_dump(mode="json"),
            "result": {"ordered_page_ids": ordered_page_ids},
        }

    if page_ids is not None and command.page_id not in page_ids:
        raise ValueError("page_id is not present in the current page array")
    if not image_id:
        return {"status": "command_ready", "command": command.model_dump(mode="json")}
    result = optimize_layout(command.page_id, image_id, page_ids=page_ids)
    return {"status": "executed", "command": command.model_dump(mode="json"), "result": result}


__all__ = [
    "AgentCommand", "EraseCommand", "EraseTarget", "ReorderPagesCommand",
    "OptimizeLayoutCommand", "TOOLS", "TOOL", "translate_text", "execute_erase",
    "reorder_pages", "optimize_layout", "execute_command", "ValidationError",
]
