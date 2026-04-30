"""Persistent connector config under %APPDATA%\\CredFloat\\config.json.

Schema (v1):
    api_url:   str   e.g. "https://app.credfloat.in/api/sync"
    api_key:   str   bearer token issued by the firm admin
    tally_dsn: str   Windows ODBC DSN, default "TallyODBC_9000"
    tally_http_url: str  default "http://localhost:9000"
    sync_interval_minutes: int  default 30
"""
from __future__ import annotations
import json
from dataclasses import dataclass, asdict
from typing import Optional

from .paths import config_path


@dataclass
class ConnectorConfig:
    api_url: str = ""
    api_key: str = ""
    tally_dsn: str = "TallyODBC_9000"
    tally_http_url: str = "http://localhost:9000"
    sync_interval_minutes: int = 30

    def is_complete(self) -> bool:
        return bool(self.api_url and self.api_key)


def load() -> ConnectorConfig:
    p = config_path()
    if not p.exists():
        return ConnectorConfig()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ConnectorConfig()
    return ConnectorConfig(
        api_url=data.get("api_url", ""),
        api_key=data.get("api_key", ""),
        tally_dsn=data.get("tally_dsn", "TallyODBC_9000"),
        tally_http_url=data.get("tally_http_url", "http://localhost:9000"),
        sync_interval_minutes=int(data.get("sync_interval_minutes", 30)),
    )


def save(cfg: ConnectorConfig) -> None:
    p = config_path()
    p.write_text(json.dumps(asdict(cfg), indent=2), encoding="utf-8")
