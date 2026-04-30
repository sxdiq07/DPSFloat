"""Long-running scheduler. Runs sync on an interval, retries with backoff,
and exposes thread-safe state for the tray UI to read.
"""
from __future__ import annotations
import json
import logging
import threading
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from typing import Callable, Optional

from . import config as config_mod
from . import syncer
from .paths import log_path, state_path

# Tray polls this every second to update icon/menu.
@dataclass
class ServiceState:
    status: str = "idle"        # idle | syncing | error | unconfigured
    last_sync_at: Optional[str] = None
    last_error: Optional[str] = None
    last_summary: Optional[dict] = None


def _setup_logging() -> logging.Logger:
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    # Idempotent — calling twice (e.g. from Sync Now) shouldn't add duplicate handlers.
    if not any(isinstance(h, RotatingFileHandler) for h in root.handlers):
        fh = RotatingFileHandler(
            log_path(), maxBytes=2_000_000, backupCount=3, encoding="utf-8"
        )
        fh.setFormatter(
            logging.Formatter(
                "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        root.addHandler(fh)
    return logging.getLogger("credfloat.service")


class Service:
    """Background scheduler. Owned by the tray app."""

    def __init__(self, on_state_change: Optional[Callable[[ServiceState], None]] = None):
        self.log = _setup_logging()
        self.state = ServiceState()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._on_state_change = on_state_change

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="credfloat-svc")
        self._thread.start()
        self.log.info("Service started.")

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=5)
        self.log.info("Service stopped.")

    def trigger_sync_now(self) -> None:
        """Wake the loop immediately. Safe to call from any thread."""
        self._wake.set()

    def get_state(self) -> ServiceState:
        with self._lock:
            return ServiceState(**asdict(self.state))

    # --- internals ---

    def _set_state(self, **fields) -> None:
        with self._lock:
            for k, v in fields.items():
                setattr(self.state, k, v)
            snapshot = ServiceState(**asdict(self.state))
        try:
            state_path().write_text(json.dumps(asdict(snapshot)), encoding="utf-8")
        except OSError:
            pass
        if self._on_state_change:
            try:
                self._on_state_change(snapshot)
            except Exception:  # tray callback errors must not crash the service
                self.log.exception("on_state_change handler raised")

    def _loop(self) -> None:
        backoff = 60  # seconds, doubles on failure up to interval
        while not self._stop.is_set():
            cfg = config_mod.load()
            if not cfg.is_complete():
                self._set_state(status="unconfigured", last_error="Run Setup to configure.")
                # Wait for either a manual trigger or 30s, then re-check.
                self._wake.wait(timeout=30)
                self._wake.clear()
                continue

            self._set_state(status="syncing", last_error=None)
            self.log.info("Starting sync cycle.")
            t0 = time.time()
            try:
                summary = syncer.run_once(cfg)
                elapsed = time.time() - t0
                self.log.info("Sync ok in %.1fs: %s", elapsed, summary.get("synced", summary))
                self._set_state(
                    status="idle",
                    last_sync_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    last_summary=summary.get("synced") if isinstance(summary, dict) else None,
                    last_error=None,
                )
                backoff = 60
                interval = max(60, cfg.sync_interval_minutes * 60)
            except syncer.SyncError as e:
                self.log.error("Sync failed: %s", e)
                self._set_state(status="error", last_error=str(e))
                interval = backoff
                backoff = min(backoff * 2, cfg.sync_interval_minutes * 60)
            except Exception as e:
                self.log.exception("Unexpected sync error")
                self._set_state(status="error", last_error=f"Unexpected: {e}")
                interval = backoff
                backoff = min(backoff * 2, cfg.sync_interval_minutes * 60)

            self._wake.wait(timeout=interval)
            self._wake.clear()
