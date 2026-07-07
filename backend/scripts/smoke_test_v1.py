from __future__ import annotations

import json
import os
from typing import Any
from urllib import error, request


BASE_URL = os.getenv("RELIA_API_BASE_URL", "http://127.0.0.1:8000")
USER_ID = os.getenv("RELIA_TEST_USER_ID")


def api_request(method: str, path: str, payload: dict[str, Any] | None = None) -> tuple[int, Any]:
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if USER_ID:
        headers["X-User-Id"] = USER_ID

    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")

    req = request.Request(url=url, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else None
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        detail = json.loads(raw) if raw else {"detail": exc.reason}
        return exc.code, detail


def main() -> int:
    checks: list[tuple[str, int, Any]] = []

    checks.append(("GET /health", *api_request("GET", "/health")))

    create_payload = {
        "card_type": "vocabulary",
        "front_content": "go raibh maith agat",
        "back_content": "thank you",
        "part_of_speech": "phrase",
        "zh_tw_definition": "thank you",
        "source": "user_input",
    }
    create_status, created = api_request("POST", "/api/v1/flashcards", create_payload)
    checks.append(("POST /api/v1/flashcards", create_status, created))

    flashcard_id = created.get("id") if isinstance(created, dict) else None

    checks.append(("GET /api/v1/flashcards", *api_request("GET", "/api/v1/flashcards")))

    if flashcard_id:
        checks.append(
            (
                "POST /api/v1/reviews",
                *api_request(
                    "POST",
                    "/api/v1/reviews",
                    {"flashcard_id": flashcard_id, "rating": "good"},
                ),
            )
        )
    else:
        checks.append(("POST /api/v1/reviews", 0, {"detail": "flashcard creation failed"}))

    checks.append(("GET /api/v1/stats", *api_request("GET", "/api/v1/stats")))

    failed = False
    for name, status, data in checks:
        print(f"{name} -> {status}")
        print(json.dumps(data, indent=2, ensure_ascii=False))
        print()
        if status >= 400 or status == 0:
            failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
