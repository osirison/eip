from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

TargetType = Literal["project", "group", "pod"]
DataSource = Literal["fixture", "live"]
MergeRequestState = Literal["opened", "merged", "closed", "locked"]


@dataclass(slots=True)
class GitLabPerson:
    id: int
    name: str
    username: str
    web_url: str | None = None


@dataclass(slots=True)
class GitLabTarget:
    id: str
    type: TargetType
    name: str
    path: str
    web_url: str | None = None


@dataclass(slots=True)
class GitLabMergeRequest:
    id: int
    iid: int
    project_id: int
    project_path: str | None
    title: str
    web_url: str
    state: MergeRequestState
    draft: bool
    author: GitLabPerson
    reviewers: list[GitLabPerson]
    created_at: str
    updated_at: str
    merged_at: str | None
    changes_count: int | None
