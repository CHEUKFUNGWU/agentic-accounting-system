"""HTTP contract matching the adopted Monolith frontend."""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.core.monolith import WorkspaceError, execute_command, load_workspace, trial_balance

router = APIRouter(prefix="/api/v1/monolith", tags=["monolith"])


class CommandRequest(BaseModel):
    model_config = {"extra": "forbid"}

    action: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    revision: int = Field(ge=0)
    commandId: UUID


@router.get("/workspace")
async def get_workspace(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await load_workspace()


@router.post("/commands")
async def command(body: CommandRequest, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await execute_command(body.action, body.payload, body.revision, str(body.commandId))
    except WorkspaceError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


@router.get("/trial-balance")
async def get_trial_balance():
    workspace = await load_workspace()
    return {"workspaceId": workspace["workspaceId"], "period": workspace["period"], "revision": workspace["revision"], **trial_balance(workspace)}
