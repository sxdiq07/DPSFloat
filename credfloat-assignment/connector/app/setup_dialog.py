"""First-run config dialog using tkinter (bundled with Python on Windows).

Asks the firm's user for:
- API URL (prefilled to the production app)
- API key (paste from the web app's "Connect Tally" page)
- Tally DSN (default fine for 99% of installs)

Returns True if the user saved a valid config.
"""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk, messagebox

from . import config as config_mod
from .config import ConnectorConfig


DEFAULT_API_URL = "https://dps-float.vercel.app/api/sync"


def open_setup(initial: ConnectorConfig | None = None) -> bool:
    cfg = initial or config_mod.load()
    saved = {"ok": False}

    root = tk.Tk()
    root.title("CredFloat Connector — Setup")
    root.geometry("500x320")
    root.resizable(False, False)

    frame = ttk.Frame(root, padding=20)
    frame.pack(fill="both", expand=True)

    ttk.Label(
        frame,
        text="Paste the connection details from your CredFloat dashboard.",
        wraplength=460,
    ).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 12))

    ttk.Label(frame, text="API URL").grid(row=1, column=0, sticky="w")
    api_url = tk.StringVar(value=cfg.api_url or DEFAULT_API_URL)
    ttk.Entry(frame, textvariable=api_url, width=50).grid(
        row=1, column=1, sticky="we", pady=4
    )

    ttk.Label(frame, text="API Key").grid(row=2, column=0, sticky="w")
    api_key = tk.StringVar(value=cfg.api_key)
    ttk.Entry(frame, textvariable=api_key, width=50, show="•").grid(
        row=2, column=1, sticky="we", pady=4
    )

    ttk.Label(frame, text="Tally HTTP URL").grid(row=3, column=0, sticky="w")
    tally_http = tk.StringVar(value=cfg.tally_http_url)
    ttk.Entry(frame, textvariable=tally_http, width=50).grid(
        row=3, column=1, sticky="we", pady=4
    )

    ttk.Label(frame, text="Sync every (minutes)").grid(row=4, column=0, sticky="w")
    interval = tk.StringVar(value=str(cfg.sync_interval_minutes))
    ttk.Entry(frame, textvariable=interval, width=10).grid(
        row=4, column=1, sticky="w", pady=4
    )

    def on_save():
        if not api_url.get().strip():
            messagebox.showerror("CredFloat", "API URL is required.")
            return
        if not api_key.get().strip():
            messagebox.showerror("CredFloat", "API Key is required.")
            return
        try:
            mins = max(5, int(interval.get().strip() or "30"))
        except ValueError:
            messagebox.showerror("CredFloat", "Sync interval must be a number.")
            return
        config_mod.save(
            ConnectorConfig(
                api_url=api_url.get().strip(),
                api_key=api_key.get().strip(),
                tally_http_url=tally_http.get().strip() or "http://localhost:9000",
                sync_interval_minutes=mins,
            )
        )
        saved["ok"] = True
        root.destroy()

    btns = ttk.Frame(frame)
    btns.grid(row=5, column=0, columnspan=2, pady=(16, 0), sticky="e")
    ttk.Button(btns, text="Cancel", command=root.destroy).pack(side="right", padx=4)
    ttk.Button(btns, text="Save", command=on_save).pack(side="right", padx=4)

    frame.columnconfigure(1, weight=1)
    root.mainloop()
    return saved["ok"]


if __name__ == "__main__":
    open_setup()
