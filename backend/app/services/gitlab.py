from __future__ import annotations

import json

import httpx

from app.core.config import Settings
from app.services.errors import NotFoundError, UpstreamError
from app.services.fixtures import get_fixture_merge_requests, get_fixture_target
from app.services.models import GitLabMergeRequest, GitLabPerson, GitLabTarget


class GitLabGateway:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self.settings = settings
        self.transport = transport

    @property
    def data_source(self) -> str:
        return "fixture" if self.settings.use_fixture_source else "live"

    def fetch_target(self, target_type: str, target_id: str) -> GitLabTarget:
        if self.settings.use_fixture_source:
            return get_fixture_target(target_type, target_id)

        encoded_target_id = httpx.QueryParams({"id": target_id}).get("id", target_id)
        path = f"/projects/{encoded_target_id}" if target_type == "project" else f"/groups/{encoded_target_id}"
        payload = self._request_json(path)

        return GitLabTarget(
            id=str(payload.get("id", target_id)),
            type=target_type,
            name=payload.get("name") or payload.get("full_name") or f"GitLab {target_type}",
            path=(
                payload.get("path_with_namespace")
                or payload.get("full_path")
                or payload.get("name")
                or payload.get("full_name")
                or f"id:{target_id}"
            ),
            web_url=payload.get("web_url"),
        )

    def fetch_recent_merge_requests(
        self,
        *,
        target_type: str,
        target_id: str,
        target_path: str,
    ) -> list[GitLabMergeRequest]:
        if self.settings.use_fixture_source:
            return get_fixture_merge_requests(target_type, target_id, self.settings.gitlab_analysis_limit)

        encoded_target_id = httpx.QueryParams({"id": target_id}).get("id", target_id)
        query = httpx.QueryParams(
            {
                "state": "all",
                "per_page": str(self.settings.gitlab_analysis_limit),
                "order_by": "updated_at",
                "sort": "desc",
            }
        )
        path = (
            f"/projects/{encoded_target_id}/merge_requests?{query}"
            if target_type == "project"
            else f"/groups/{encoded_target_id}/merge_requests?{query}"
        )
        payload = self._request_json(path)

        merge_requests: list[GitLabMergeRequest] = []
        for merge_request in payload:
            changes_count = self._parse_changes_count(merge_request.get("changes_count"))
            if changes_count is None:
                changes_count = self._safe_fetch_changes_count(merge_request["project_id"], merge_request["iid"])

            merge_requests.append(
                GitLabMergeRequest(
                    id=merge_request["id"],
                    iid=merge_request["iid"],
                    project_id=merge_request["project_id"],
                    project_path=(
                        target_path
                        if target_type == "project"
                        else self._extract_project_path(merge_request.get("references"))
                        or f"project-{merge_request['project_id']}"
                    ),
                    title=merge_request["title"],
                    web_url=merge_request["web_url"],
                    state=self._normalize_state(merge_request.get("state", "opened")),
                    draft=bool(merge_request.get("draft") or merge_request.get("work_in_progress")),
                    author=self._map_user(merge_request["author"]),
                    reviewers=[self._map_user(user) for user in merge_request.get("reviewers", [])],
                    created_at=merge_request["created_at"],
                    updated_at=merge_request["updated_at"],
                    merged_at=merge_request.get("merged_at"),
                    changes_count=changes_count,
                )
            )

        return merge_requests

    def _safe_fetch_changes_count(self, project_id: int, merge_request_iid: int) -> int | None:
        try:
            payload = self._request_json(
                f"/projects/{project_id}/merge_requests/{merge_request_iid}"
            )
        except UpstreamError:
            return None

        return self._parse_changes_count(payload.get("changes_count"))

    def _request_json(self, path: str):
        if not self.settings.gitlab_token:
            raise UpstreamError("GitLab credentials are not configured.", 500)

        with httpx.Client(
            base_url=self.settings.normalized_gitlab_base_url,
            headers={
                "Accept": "application/json",
                "PRIVATE-TOKEN": self.settings.gitlab_token,
            },
            transport=self.transport,
            timeout=30.0,
        ) as client:
            response = client.get(path)

        if response.status_code == 404:
            raise NotFoundError(self._extract_error_message(response) or "The GitLab target was not found.")

        if response.status_code >= 400:
            raise UpstreamError(
                self._extract_error_message(response) or "GitLab request failed.",
                502,
            )

        return response.json()

    @staticmethod
    def _extract_error_message(response: httpx.Response) -> str | None:
        if not response.text:
            return None

        try:
            payload = response.json()
        except json.JSONDecodeError:
            return response.text

        message = payload.get("message")
        if isinstance(message, str):
            return message

        if isinstance(message, dict):
            first_value = next(iter(message.values()), None)
            if isinstance(first_value, list) and first_value:
                return str(first_value[0])

        error = payload.get("error")
        return str(error) if isinstance(error, str) else response.text

    @staticmethod
    def _extract_project_path(references: dict | None) -> str | None:
        if not references:
            return None
        reference = references.get("full") or references.get("relative")
        if not reference:
            return None
        return str(reference).split("!")[0]

    @staticmethod
    def _map_user(payload: dict) -> GitLabPerson:
        return GitLabPerson(
            id=payload["id"],
            name=payload["name"],
            username=payload["username"],
            web_url=payload.get("web_url"),
        )

    @staticmethod
    def _normalize_state(state: str) -> str:
        if state in {"merged", "closed", "locked"}:
            return state
        return "opened"

    @staticmethod
    def _parse_changes_count(changes_count: str | int | None) -> int | None:
        if changes_count in (None, ""):
            return None
        try:
            return int(changes_count)
        except (TypeError, ValueError):
            return None
