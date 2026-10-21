"""Let helpers join a caller's transaction without committing it."""
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession


@asynccontextmanager
async def transaction_session(manager, session: AsyncSession | None = None):
    if session is not None:
        yield session
    else:
        async with manager.session_factory() as owned, owned.begin():
            yield owned
