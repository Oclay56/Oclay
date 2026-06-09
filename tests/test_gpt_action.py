from fastapi.testclient import TestClient

from app.gpt_action import build_gpt_action_openapi_schema
from app.main import app


def _operation_ids(schema: dict) -> set[str]:
    return {
        operation["operationId"]
        for path_item in schema["paths"].values()
        for operation in path_item.values()
    }


def test_gpt_schema_is_oclay_scoped():
    schema = build_gpt_action_openapi_schema("https://oclay.example")

    assert schema["servers"] == [{"url": "https://oclay.example"}]
    assert schema["info"]["title"] == "OCLAY Data API"
    assert len(_operation_ids(schema)) <= 30


def test_gpt_schema_keeps_core_review_and_build_actions():
    schema = build_gpt_action_openapi_schema("https://oclay.example")
    operation_ids = _operation_ids(schema)

    assert "getStakeUiSgmBoard" in operation_ids
    assert "buildStakeUiSgmCandidatePool" in operation_ids
    assert "validateSelections" in operation_ids
    assert "buildStakeUiReviewSlipBatch" in operation_ids
    assert "clearStakeUiSidebar" in operation_ids
    assert "getPlayerMlbContext" in operation_ids


def test_gpt_schema_excludes_removed_history_ml_and_moneyline_actions():
    schema = build_gpt_action_openapi_schema("https://oclay.example")
    paths = set(schema["paths"])
    operation_ids = _operation_ids(schema)

    assert "/mlb/save-gpt-decision" not in paths
    assert "/mlb/stake-ui/mlb-moneylines" not in paths
    assert "/mlb/stake-ui/moneyline-review-slip" not in paths
    assert all("History" not in operation_id for operation_id in operation_ids)
    assert all("Moneyline" not in operation_id for operation_id in operation_ids)


def test_removed_save_decision_route_is_not_available():
    with TestClient(app) as client:
        response = client.post("/mlb/save-gpt-decision", json={})

    assert response.status_code == 404
