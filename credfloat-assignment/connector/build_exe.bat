@echo off
REM CredFloat Connector — build credfloat-connector.exe via PyInstaller.
REM Run from this folder. Requires Python 3.11+ and: pip install -r requirements.txt
setlocal

where python >nul 2>nul
if errorlevel 1 (
  echo [build] python not found in PATH. Install Python 3.11+ first.
  exit /b 1
)

echo [build] Cleaning previous build artifacts...
if exist build rmdir /s /q build
if exist dist  rmdir /s /q dist

echo [build] Installing/refreshing dependencies...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [build] Dependency install failed.
  exit /b 1
)

echo [build] Running PyInstaller...
python -m PyInstaller credfloat-connector.spec --clean --noconfirm
if errorlevel 1 (
  echo [build] PyInstaller failed.
  exit /b 1
)

if not exist "dist\credfloat-connector.exe" (
  echo [build] Expected dist\credfloat-connector.exe not found.
  exit /b 1
)

echo.
echo [build] OK. Output: dist\credfloat-connector.exe
for %%I in ("dist\credfloat-connector.exe") do echo [build] Size: %%~zI bytes
echo.
endlocal
