from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import Session, close_all_sessions, sessionmaker

_ENGINE_CACHE: dict[str, Engine] = {}
_SESSION_FACTORY_CACHE: dict[str, sessionmaker[Session]] = {}


def get_engine(database_url: str) -> Engine:
    engine = _ENGINE_CACHE.get(database_url)
    if engine is not None:
        return engine

    connect_args: dict[str, object] = {}
    url = make_url(database_url)

    if url.drivername.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    engine = create_engine(database_url, pool_pre_ping=True, connect_args=connect_args)

    if url.drivername.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    _ENGINE_CACHE[database_url] = engine
    return engine


def get_session_factory(database_url: str) -> sessionmaker[Session]:
    session_factory = _SESSION_FACTORY_CACHE.get(database_url)
    if session_factory is not None:
        return session_factory

    session_factory = sessionmaker(bind=get_engine(database_url), autoflush=False, expire_on_commit=False)
    _SESSION_FACTORY_CACHE[database_url] = session_factory
    return session_factory


def session_scope(database_url: str) -> Generator[Session, None, None]:
    session = get_session_factory(database_url)()
    try:
        yield session
    finally:
        session.close()


def dispose_engine(database_url: str) -> None:
    session_factory = _SESSION_FACTORY_CACHE.pop(database_url, None)
    if session_factory is not None:
        close_all_sessions()

    engine = _ENGINE_CACHE.pop(database_url, None)
    if engine is not None:
        engine.dispose()
