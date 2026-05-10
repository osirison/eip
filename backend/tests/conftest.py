from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_settings_dependency
from app.core.config import Settings
from app.db.base import Base
from app.db.seed import seed_dev_pod
from app.db.session import dispose_engine, get_engine, get_session_factory
from app.main import create_app


@pytest.fixture()
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite+pysqlite:///{tmp_path / 'backend-test.db'}",
        gitlab_use_fixtures=True,
        gitlab_token=None,
    )


@pytest.fixture()
def engine(settings: Settings):
    engine = get_engine(settings.database_url)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    dispose_engine(settings.database_url)


@pytest.fixture()
def session(settings: Settings, engine):
    session_factory = get_session_factory(settings.database_url)
    with session_factory() as db_session:
        seed_dev_pod(db_session)
        db_session.commit()
        yield db_session


@pytest.fixture()
def client(settings: Settings, engine) -> TestClient:
    session_factory = get_session_factory(settings.database_url)
    with session_factory() as db_session:
        seed_dev_pod(db_session)
        db_session.commit()

    app = create_app()
    app.dependency_overrides[get_settings_dependency] = lambda: settings

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
