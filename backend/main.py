from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .ai_agent import AgentCommand, execute_command, translate_text
from .app.agents import process_document_pipeline
from .document_router import DocumentRouter

app = FastAPI(title="ClearPage API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


class AgentRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    image_id: str | None = Field(default=None, max_length=255)
    page_ids: list[int] | None = Field(default=None, min_length=1, max_length=500)


class AgentResponse(BaseModel):
    command: AgentCommand
    status: str
    result: Any | None = None


class DocumentResponse(BaseModel):
    document_hash: str
    cache_hit: bool
    classification: dict[str, Any]
    model_used: str
    extraction: dict[str, Any]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/agent/command", response_model=AgentResponse)
def agent_command(request: AgentRequest) -> AgentResponse:
    try:
        command = translate_text(request.text)
        execution = execute_command(command, image_id=request.image_id, page_ids=request.page_ids)
    except (ValueError, FileNotFoundError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return AgentResponse(command=command, status=execution["status"], result=execution.get("result"))


@app.post("/v1/documents/process", response_model=DocumentResponse)
async def process_document(file: UploadFile = File(...)) -> DocumentResponse:
    """Classify and extract an uploaded document, returning a hash-cached JSON result."""

    if not file.filename:
        raise HTTPException(status_code=400, detail="uploaded file requires a filename")
    content = await file.read()
    try:
        result = DocumentRouter().process(content, file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return DocumentResponse.model_validate(result)


@app.post("/v1/documents/pipeline")
async def process_document_pipeline_route(file: UploadFile = File(...)) -> dict[str, Any]:
    """Run the autonomous Router/Cleaner/Extraction/Format workflow on a ZIP."""

    if not file.filename:
        raise HTTPException(status_code=400, detail="uploaded archive requires a filename")
    try:
        return process_document_pipeline(await file.read(), filename=file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
