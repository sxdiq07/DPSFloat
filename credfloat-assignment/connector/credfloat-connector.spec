# PyInstaller spec — produces dist/credfloat-connector.exe (windowed, one-file).
# Build: pyinstaller credfloat-connector.spec --clean --noconfirm
# Or: build_exe.bat
# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

hiddenimports = (
    collect_submodules("pyodbc")
    + collect_submodules("pystray")
    + collect_submodules("PIL")
    + [
        "tally_connector",
        "tally_invoices",
        "tally_receipts",
        "tally_daybook",
        "app",
        "app.config",
        "app.paths",
        "app.service",
        "app.syncer",
        "app.tray",
        "app.setup_dialog",
    ]
)

a = Analysis(
    ["credfloat_main.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["matplotlib", "numpy", "scipy", "pandas", "pytest", "tkinter.test"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="credfloat-connector",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,            # hide the console window — tray app
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # icon="assets/credfloat.ico",  # add when we have a real icon
)
