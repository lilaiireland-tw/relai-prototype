from __future__ import annotations

import json
import os
from typing import Any
from urllib import error, request


BASE_URL = os.getenv("RELIA_API_BASE_URL", "http://127.0.0.1:8000")
TEST_EMAIL = os.getenv("RELIA_TEST_EMAIL", "relai-smoke@example.com")
TEST_PASSWORD = os.getenv("RELIA_TEST_PASSWORD", "RelaiSmoke123")


def api_request(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    token: str | None = None,
) -> tuple[int, Any]:
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

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
        if raw:
            try:
                detail = json.loads(raw)
            except json.JSONDecodeError:
                detail = {"detail": raw}
        else:
            detail = {"detail": exc.reason}
        return exc.code, detail


def main() -> int:
    checks: list[tuple[str, int, Any]] = []

    checks.append(("GET /health", *api_request("GET", "/health")))
    register_status, register_data = api_request(
        "POST",
        "/api/v1/auth/register",
        {"email": TEST_EMAIL, "password": TEST_PASSWORD, "display_name": "Smoke Test"},
    )
    checks.append(("POST /api/v1/auth/register", register_status, register_data))

    if register_status == 409:
        checks[-1] = ("POST /api/v1/auth/register", register_status, {"detail": "already registered"})

    login_status, login_data = api_request(
        "POST",
        "/api/v1/auth/login",
        {"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    checks.append(("POST /api/v1/auth/login", login_status, login_data))

    token = login_data.get("access_token") if isinstance(login_data, dict) else None

    checks.append(("POST /api/v1/auth/bootstrap", *api_request("POST", "/api/v1/auth/bootstrap", token=token)))
    checks.append(("GET /api/v1/auth/me", *api_request("GET", "/api/v1/auth/me", token=token)))
    checks.append(("GET /api/v1/settings", *api_request("GET", "/api/v1/settings", token=token)))
    checks.append(
        (
            "PATCH /api/v1/settings",
            *api_request(
                "PATCH",
                "/api/v1/settings",
                {"daily_review_goal": 15, "review_reminder_enabled": True},
                token=token,
            ),
        )
    )

    create_payload = {
        "card_type": "vocabulary",
        "front_content": "go raibh maith agat",
        "back_content": "thank you",
        "part_of_speech": "phrase",
        "zh_tw_definition": "thank you",
        "source": "user_input",
    }
    create_status, created = api_request("POST", "/api/v1/flashcards", create_payload, token=token)
    checks.append(("POST /api/v1/flashcards", create_status, created))

    flashcard_id = created.get("id") if isinstance(created, dict) else None

    checks.append(("GET /api/v1/flashcards", *api_request("GET", "/api/v1/flashcards", token=token)))

    if flashcard_id:
        checks.append(
            (
                "POST /api/v1/reviews",
                *api_request(
                    "POST",
                    "/api/v1/reviews",
                    {"flashcard_id": flashcard_id, "rating": "good"},
                    token=token,
                ),
            )
        )
    else:
        checks.append(("POST /api/v1/reviews", 0, {"detail": "flashcard creation failed"}))

    checks.append(("GET /api/v1/stats", *api_request("GET", "/api/v1/stats", token=token)))
    checks.append(("POST /api/v1/auth/logout", *api_request("POST", "/api/v1/auth/logout", token=token)))
    checks.append(("GET /api/v1/auth/me after logout", *api_request("GET", "/api/v1/auth/me", token=token)))

    failed = False
    for name, status, data in checks:
        print(f"{name} -> {status}")
        print(json.dumps(data, indent=2, ensure_ascii=False))
        print()
        if status == 0:
            failed = True
        elif name == "POST /api/v1/auth/register":
            if status not in (201, 409):
                failed = True
        elif name == "GET /api/v1/auth/me after logout":
            if status != 401:
                failed = True
        elif status >= 400:
            failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
