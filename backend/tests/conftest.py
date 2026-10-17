import os
import shutil
import tempfile
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Point database to isolated temp directory for test execution
_temp_dir = tempfile.mkdtemp(prefix="agentic_acc_test_")
os.environ["AGENTIC_ACCOUNTING_DATA_DIR"] = _temp_dir

from app.core.db import db_manager
from app.core.repository import repo
from app.main import app

@pytest.fixture(scope="session", autouse=True)
def cleanup_temp_dir():
    yield
    try:
        shutil.rmtree(_temp_dir)
    except Exception:
        pass

@pytest_asyncio.fixture(scope="session", autouse=True)
async def initialize_test_database():
    await db_manager.init_db()
    await repo.init_seed_data_if_needed()
    from app.core.ledger import migrate_entity_core
    from app.mcp_server import ENTITIES, sync_state_from_db

    await sync_state_from_db()
    from app.core.auth import seed_principals, provision_principal
    await seed_principals()
    await provision_principal("test-finance-human", "Test finance operator", "FINANCE_MANAGER", password="test-fixture-password-only")
    await provision_principal("test-cpa-human", "Test external reviewer", "CPA_ADVISOR", password="test-fixture-password-only")
    await provision_principal("test-admin-human", "Test administrator", "ADMIN", password="test-fixture-password-only")
    for code, meta in ENTITIES.items():
        await migrate_entity_core(code, meta["jurisdiction"], currency=meta["currency"])

@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        await login_as(ac, "test-finance-human")
        yield ac


async def login_as(client, key):
    response = await client.post("/api/v1/auth/login", json={"username": key, "password": "test-fixture-password-only"})
    assert response.status_code == 200, response.text
    session_token = response.cookies.get("aas_session")
    client.cookies.clear()
    client.cookies.set("aas_session", session_token)
    client.headers.pop("Authorization", None)
    client.headers["X-CSRF-Token"] = response.json()["csrfToken"]


async def agent_as(client, key):
    from app.core.auth import issue_key
    credential = await issue_key(key)
    client.headers["Authorization"] = "Bearer " + credential["token"]
