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
    for code, meta in ENTITIES.items():
        await migrate_entity_core(code, meta["jurisdiction"], currency=meta["currency"])

@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
