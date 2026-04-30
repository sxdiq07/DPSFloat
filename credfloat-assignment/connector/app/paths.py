"""Resolve per-user CredFloat paths under %APPDATA%."""
from __future__ import annotations
import os
from pathlib import Path


def appdata_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    p = Path(base) / "CredFloat"
    p.mkdir(parents=True, exist_ok=True)
    return p


def config_path() -> Path:
    return appdata_dir() / "config.json"


def log_dir() -> Path:
    p = appdata_dir() / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def log_path() -> Path:
    return log_dir() / "connector.log"


def state_path() -> Path:
    return appdata_dir() / "state.json"
