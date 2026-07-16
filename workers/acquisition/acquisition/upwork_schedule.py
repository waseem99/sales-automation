from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime, time
import json
from pathlib import Path
import tomllib
from typing import Any
from zoneinfo import ZoneInfo


_DAY_NAMES = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)


@dataclass(frozen=True, slots=True)
class ScheduleWindow:
    id: str
    timezone: str
    start_local: time
    end_local: time
    days: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AcquisitionSchedule:
    cadence_minutes: int
    start_offset_minutes: int
    windows: tuple[ScheduleWindow, ...]


@dataclass(frozen=True, slots=True)
class ScheduleDecision:
    active: bool
    checked_at_utc: str
    cadence_minutes: int
    start_offset_minutes: int
    matched_windows: tuple[str, ...]
    windows: tuple[dict[str, Any], ...]
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_acquisition_schedule(path: Path) -> AcquisitionSchedule:
    with path.open("rb") as handle:
        raw = tomllib.load(handle)
    schedule = raw.get("schedule", {})
    cadence = max(15, min(int(schedule.get("cadence_minutes", 30)), 240))
    offset = max(0, min(int(schedule.get("start_offset_minutes", 7)), cadence - 1))
    windows: list[ScheduleWindow] = []
    for item in schedule.get("windows", []):
        days = tuple(str(value).strip().casefold() for value in item.get("days", _DAY_NAMES))
        if not days or any(value not in _DAY_NAMES for value in days):
            raise ValueError("Every schedule window must use valid English weekday names")
        timezone_name = str(item.get("timezone", "")).strip()
        if not timezone_name:
            raise ValueError("Every schedule window requires an IANA timezone")
        ZoneInfo(timezone_name)
        windows.append(
            ScheduleWindow(
                id=_required(item, "id"),
                timezone=timezone_name,
                start_local=_clock(item.get("start_local"), "start_local"),
                end_local=_clock(item.get("end_local"), "end_local"),
                days=days,
            )
        )
    if not windows:
        raise ValueError("At least one acquisition schedule window is required")
    return AcquisitionSchedule(
        cadence_minutes=cadence,
        start_offset_minutes=offset,
        windows=tuple(windows),
    )


def evaluate_acquisition_schedule(path: Path, *, now_utc: datetime | None = None) -> ScheduleDecision:
    schedule = load_acquisition_schedule(path)
    current = now_utc or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    else:
        current = current.astimezone(UTC)

    matched: list[str] = []
    rendered: list[dict[str, Any]] = []
    for window in schedule.windows:
        local = current.astimezone(ZoneInfo(window.timezone))
        local_day = _DAY_NAMES[local.weekday()]
        active = local_day in window.days and _time_in_window(local.time(), window.start_local, window.end_local)
        if active:
            matched.append(window.id)
        rendered.append(
            {
                "id": window.id,
                "timezone": window.timezone,
                "local_time": local.isoformat(),
                "start_local": window.start_local.strftime("%H:%M"),
                "end_local": window.end_local.strftime("%H:%M"),
                "day": local_day,
                "active": active,
            }
        )

    return ScheduleDecision(
        active=bool(matched),
        checked_at_utc=current.isoformat().replace("+00:00", "Z"),
        cadence_minutes=schedule.cadence_minutes,
        start_offset_minutes=schedule.start_offset_minutes,
        matched_windows=tuple(matched),
        windows=tuple(rendered),
        reason=(
            "One or more target-market opportunity windows are active."
            if matched
            else "Outside the configured US and Australian opportunity windows."
        ),
    )


def write_schedule_status(path: Path, decision: ScheduleDecision) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(decision.to_dict(), indent=2, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def _time_in_window(value: time, start: time, end: time) -> bool:
    comparable = value.replace(tzinfo=None)
    if start <= end:
        return start <= comparable <= end
    return comparable >= start or comparable <= end


def _clock(value: object, field: str) -> time:
    text = str(value or "").strip()
    try:
        return datetime.strptime(text, "%H:%M").time()
    except ValueError as error:
        raise ValueError(f"{field} must use 24-hour HH:MM format") from error


def _required(value: dict[str, Any], key: str) -> str:
    text = str(value.get(key, "")).strip()
    if not text:
        raise ValueError(f"{key} is required")
    return text
