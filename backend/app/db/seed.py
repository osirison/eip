from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Pod, PodTarget

DEV_POD_SLUG = "platform-foundation"


def seed_dev_pod(session: Session) -> Pod:
    existing = session.scalar(select(Pod).where(Pod.slug == DEV_POD_SLUG))
    if existing is not None:
        return existing

    pod = Pod(
        slug=DEV_POD_SLUG,
        name="Platform Foundation",
        description="Core platform delivery across shared groups and foundational services.",
        targets=[
            PodTarget(target_type="group", target_id="7", display_order=0),
            PodTarget(target_type="project", target_id="1042", display_order=1),
            PodTarget(target_type="project", target_id="4021", display_order=2),
        ],
    )
    session.add(pod)
    session.flush()
    return pod
