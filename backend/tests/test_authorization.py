from app.auth import (
    CurrentUser,
    can_access_diagnosis,
    diagnosis_assignee_for_create,
    sanitize_diagnosis_update,
)


def user(user_id: str, role: str = "agent") -> CurrentUser:
    return CurrentUser(
        id=user_id,
        email=f"{user_id}@example.invalid",
        full_name=user_id,
        role=role,
        operating_country="PA",
    )


def test_assignee_can_access_diagnosis() -> None:
    assert can_access_diagnosis(user("owner"), {"assigned_to": "owner"}) is True


def test_other_user_cannot_access_diagnosis() -> None:
    assert can_access_diagnosis(user("other"), {"assigned_to": "owner"}) is False


def test_admin_can_access_any_diagnosis() -> None:
    assert can_access_diagnosis(user("admin", role="admin"), {"assigned_to": "owner"}) is True


def test_unassigned_diagnosis_is_admin_only() -> None:
    assert can_access_diagnosis(user("agent"), {"assigned_to": None}) is False
    assert can_access_diagnosis(user("admin", role="admin"), {"assigned_to": None}) is True


def test_agent_cannot_assign_diagnosis_to_another_user() -> None:
    agent = user("agent")
    assert diagnosis_assignee_for_create(agent, "another-user") == "agent"
    assert "assigned_to" not in sanitize_diagnosis_update(agent, {"assigned_to": "another-user"})


def test_admin_can_assign_diagnosis_to_another_user() -> None:
    admin = user("admin", role="admin")
    assert diagnosis_assignee_for_create(admin, "another-user") == "another-user"
    assert sanitize_diagnosis_update(admin, {"assigned_to": "another-user"})["assigned_to"] == "another-user"
