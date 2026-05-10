from app.core.config import get_settings
from app.db.seed import seed_dev_pod
from app.db.session import get_session_factory


def main() -> None:
    settings = get_settings()
    session_factory = get_session_factory(settings.database_url)
    with session_factory() as session:
        pod = seed_dev_pod(session)
        session.commit()
        print(f"Seeded pod {pod.slug} ({pod.id})")


if __name__ == "__main__":
    main()