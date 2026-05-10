from fastapi.testclient import TestClient


def test_healthz(client: TestClient) -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_list_pods_returns_seeded_pod(client: TestClient) -> None:
    response = client.get("/v1/pods")

    assert response.status_code == 200
    payload = response.json()
    assert payload["pods"][0]["slug"] == "platform-foundation"
    assert payload["pods"][0]["targetCount"] == 3


def test_create_pod_persists_mixed_targets(client: TestClient) -> None:
    response = client.post(
        "/v1/pods",
        json={
            "name": "Reliability",
            "description": "Reliability operating slice",
            "targets": [
                {"targetType": "project", "targetId": "1042"},
                {"targetType": "group", "targetId": "7"},
                {"targetType": "project", "targetId": "1042"},
            ],
        },
    )

    assert response.status_code == 201
    payload = response.json()["pod"]
    assert payload["slug"] == "reliability"
    assert payload["targetCount"] == 2
    assert [target["displayOrder"] for target in payload["targets"]] == [0, 1]

    get_response = client.get(f"/v1/pods/{payload['id']}")
    assert get_response.status_code == 200
    assert len(get_response.json()["pod"]["targets"]) == 2


def test_ad_hoc_report_returns_not_found_for_unknown_fixture_target(client: TestClient) -> None:
    response = client.post(
        "/v1/reports/ad-hoc",
        json={"targetType": "project", "targetId": "999999"},
    )

    assert response.status_code == 404
    assert response.json() == {"error": "The GitLab target was not found."}


def test_pod_report_exposes_target_coverage_and_project_breakdown(client: TestClient) -> None:
    pods_response = client.get("/v1/pods")
    pod_id = pods_response.json()["pods"][0]["id"]

    response = client.post(f"/v1/reports/pods/{pod_id}")

    assert response.status_code == 200
    payload = response.json()["report"]
    assert payload["target"]["type"] == "pod"
    assert payload["targetCoverage"]["requestedTargetCount"] == 3
    assert payload["targetCoverage"]["partialFailure"] is False
    assert payload["targetCoverage"]["deduplicatedMergeRequests"] < sum(
        item["mergeRequestsAnalyzed"] for item in payload["targetCoverage"]["items"]
    )
    assert payload["openQueue"]["total"] >= payload["openQueue"]["stale"]
    assert len(payload["projectBreakdown"]) >= 3
