from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .ai_agent import AgentCommand, execute_command, translate_text

app = FastAPI(title="ClearPage API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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
