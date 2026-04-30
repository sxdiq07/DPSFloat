"""System-tray UI for the CredFloat connector.

Runs the Service in a background thread; the tray itself owns the main thread
so Windows shows the icon and menu correctly.
"""
from __future__ import annotations
import os
import subprocess
import sys
import threading
import webbrowser
from typing import Optional

import pystray
from PIL import Image, ImageDraw

from . import config as config_mod
from .paths import log_path
from .service import Service, ServiceState
from .setup_dialog import open_setup


# --- Icon rendering --------------------------------------------------------
# Drawn programmatically so we don't need to ship a .ico for every state.
ICON_SIZE = 64

_COLORS = {
    "idle": (34, 139, 230),         # blue
    "syncing": (250, 176, 5),       # amber
    "error": (240, 62, 62),         # red
    "unconfigured": (134, 142, 150),  # grey
}


def _icon_for(status: str) -> Image.Image:
    img = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    color = _COLORS.get(status, _COLORS["idle"])
    d.ellipse((4, 4, ICON_SIZE - 4, ICON_SIZE - 4), fill=color)
    # White "C" mark — close enough to a logo for V1.
    d.arc((14, 14, ICON_SIZE - 14, ICON_SIZE - 14), start=45, end=315,
          fill=(255, 255, 255), width=6)
    return img


# --- Menu actions ----------------------------------------------------------

def _open_logs() -> None:
    p = log_path()
    if not p.exists():
        p.write_text("", encoding="utf-8")
    try:
        os.startfile(str(p))  # Windows
    except OSError:
        webbrowser.open(p.as_uri())


def _open_setup_threaded() -> None:
    # tkinter must run on its own thread when launched from a pystray callback —
    # pystray on Windows calls into us from its message-pump thread, and a
    # second tk.Tk() on that thread blocks the icon.
    def go():
        try:
            open_setup()
        except Exception:
            import traceback; traceback.print_exc()
    threading.Thread(target=go, daemon=True).start()


def _quit(icon: pystray.Icon, service: Service) -> None:
    service.stop()
    icon.stop()


# --- Tray app --------------------------------------------------------------

def run_tray() -> None:
    service = Service()
    icon: Optional[pystray.Icon] = None

    def title_for(s: ServiceState) -> str:
        base = "CredFloat Connector"
        if s.status == "syncing":
            return f"{base} — Syncing…"
        if s.status == "error":
            return f"{base} — Error: {s.last_error or 'unknown'}"
        if s.status == "unconfigured":
            return f"{base} — Setup required"
        if s.last_sync_at:
            return f"{base} — Last sync {s.last_sync_at}"
        return f"{base} — Idle"

    def refresh(_=None) -> None:
        if icon is None:
            return
        s = service.get_state()
        icon.icon = _icon_for(s.status)
        icon.title = title_for(s)

    def sync_now(icon_, item):
        service.trigger_sync_now()

    def open_setup_(icon_, item):
        _open_setup_threaded()
        # Nudge the loop in case config went from incomplete -> complete.
        service.trigger_sync_now()

    menu = pystray.Menu(
        pystray.MenuItem("Sync now", sync_now),
        pystray.MenuItem("Setup…", open_setup_),
        pystray.MenuItem("View logs", lambda i, _: _open_logs()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit", lambda i, _: _quit(icon, service)),
    )

    icon = pystray.Icon(
        "credfloat-connector",
        _icon_for("idle"),
        "CredFloat Connector",
        menu=menu,
    )

    # If unconfigured on first launch, pop the setup dialog before starting.
    if not config_mod.load().is_complete():
        _open_setup_threaded()

    # Hook state changes into the icon refresh.
    service._on_state_change = lambda _s: refresh()  # type: ignore[attr-defined]
    service.start()

    # Periodic refresh so the title updates even if no state event fires.
    def ticker():
        import time
        while True:
            time.sleep(2)
            try:
                refresh()
            except Exception:
                pass
    threading.Thread(target=ticker, daemon=True).start()

    icon.run()


if __name__ == "__main__":
    run_tray()
