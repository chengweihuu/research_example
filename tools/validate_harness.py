#!/usr/bin/env python3
"""Read-only structural checks for the research harness."""

from __future__ import annotations

import argparse
from pathlib import Path


REQUIRED_ACTIVE = (
    "## Identity",
    "## Question",
    "## Context",
    "## Allowed Changes",
    "## Non-goals",
    "## Budget",
    "## Done When",
    "## Stop and Ask",
    "## Outputs",
    "## Build Contract",
    "## Closeout Plan: Pending",
)
INACTIVE = "# Current Task\n\nStatus: Inactive\n\n下一步：根据 CURRENT 进入 THINK；用户确认计划后再替换本文件。"


def check_task(text: str) -> list[str]:
    errors: list[str] = []
    if text.strip() == INACTIVE:
        return errors
    if "Status: Inactive" in text:
        return ["Inactive TASK must use the exact minimal shape"]
    lowered = text.lower()
    if "Status: Active" not in text:
        errors.append("TASK must be Active for BUILD validation")
    for heading in REQUIRED_ACTIVE:
        if heading not in text:
            errors.append(f"TASK missing {heading}")
    for needle, message in (
        ("Environment Contract", "TASK missing Environment Contract gate"),
        ("Smoke", "TASK missing Smoke compute gate"),
        ("Pilot", "TASK missing Pilot compute gate"),
        ("Scale", "TASK missing Scale compute gate"),
        ("Formal", "TASK missing Formal compute gate"),
        ("bounded Result Packet", "TASK missing bounded Result Packet contract"),
    ):
        if needle.lower() not in lowered:
            errors.append(message)
    return errors


def check_repository(root: Path) -> list[str]:
    errors: list[str] = []
    task = root / "state/TASK.md"
    if not task.is_file():
        return ["state/TASK.md is missing"]
    errors.extend(check_task(task.read_text(encoding="utf-8")))

    required_files = (
        "state/CONTEXT.md",
        "docs/references/REFERENCE_TEMPLATE.md",
        "docker/ENVIRONMENT_CONTRACT.md",
    )
    for relative in required_files:
        if not (root / relative).is_file():
            errors.append(f"required template missing: {relative}")

    context = (root / "state/CONTEXT.md").read_text(encoding="utf-8") if (root / "state/CONTEXT.md").is_file() else ""
    context_lower = context.lower()
    for needle in ("delegation packet", "result packet", "sha256", "raw tool output"):
        if needle not in context_lower:
            errors.append(f"CONTEXT missing {needle}")

    env = (root / "docker/ENVIRONMENT_CONTRACT.md").read_text(encoding="utf-8") if (root / "docker/ENVIRONMENT_CONTRACT.md").is_file() else ""
    for needle in ("Mode:", "Dependency lockfile", "Data manifest", "Approved compute stage"):
        if needle not in env:
            errors.append(f"environment contract missing {needle}")

    ignored = (root / ".gitignore").read_text(encoding="utf-8")
    for needle in ("/runs/", "context-cache", "raw/"):
        if needle not in ignored:
            errors.append(f".gitignore missing artifact rule: {needle}")
    return errors


def self_test() -> list[str]:
    """Exercise each gate with a deliberately malformed task fixture."""
    valid = "Status: Active\n" + "\n".join(REQUIRED_ACTIVE) + "\nEnvironment Contract Smoke Pilot Scale Formal bounded Result Packet"
    cases = {
        "status": valid.replace("Status: Active", "Status: Inactive"),
        "environment": valid.replace("Environment Contract", "Environment"),
        "compute": valid.replace("Smoke Pilot Scale Formal", "Smoke Pilot"),
        "delegation": valid.replace("bounded Result Packet", "Result"),
    }
    failures: list[str] = []
    if check_task(INACTIVE):
        failures.append("valid Inactive TASK fixture was rejected")
    for name, fixture in cases.items():
        if not check_task(fixture):
            failures.append(f"self-test fixture unexpectedly passed: {name}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    errors = check_repository(args.repo)
    if args.self_test:
        errors.extend(self_test())
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("harness validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
