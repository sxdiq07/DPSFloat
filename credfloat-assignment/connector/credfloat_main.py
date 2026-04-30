"""Entry point for the bundled .exe.

Single-instance check via a named mutex (Windows): re-running the exe brings
focus back to the existing tray icon instead of spawning a second copy.
"""
from __future__ import annotations
import sys

from app.tray import run_tray


def _acquire_single_instance() -> bool:
    """Return True if we got the lock; False if another instance owns it."""
    try:
        import ctypes
        from ctypes import wintypes
    except Exception:
        return True  # not Windows or no ctypes — let it run

    ERROR_ALREADY_EXISTS = 183
    kernel32 = ctypes.windll.kernel32
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    kernel32.CreateMutexW.argtypes = [wintypes.LPCVOID, wintypes.BOOL, wintypes.LPCWSTR]
    handle = kernel32.CreateMutexW(None, False, "Global\\CredFloatConnectorMutex")
    if not handle:
        return True
    if kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
        return False
    return True


def main() -> int:
    if not _acquire_single_instance():
        # Already running. Silent exit — the tray icon is visible to the user.
        return 0
    run_tray()
    return 0


if __name__ == "__main__":
    sys.exit(main())
