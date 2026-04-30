@echo off
REM Build the Inno Setup installer. Requires Inno Setup 6 (iscc.exe) on PATH or
REM installed at the default location.
setlocal

if not exist "dist\credfloat-connector.exe" (
  echo [installer] dist\credfloat-connector.exe not found.
  echo [installer] Run build_exe.bat first.
  exit /b 1
)

set "ISCC="
where iscc >nul 2>nul && set "ISCC=iscc"
if "%ISCC%"=="" (
  if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
)
if "%ISCC%"=="" (
  if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
)
if "%ISCC%"=="" (
  echo [installer] Inno Setup 6 not found. Install from https://jrsoftware.org/isinfo.php
  exit /b 1
)

echo [installer] Compiling with: %ISCC%
"%ISCC%" "installer\CredFloatSetup.iss"
if errorlevel 1 (
  echo [installer] Inno Setup compile failed.
  exit /b 1
)

echo.
echo [installer] OK. Output: installer\Output\CredFloatSetup.exe
echo.
endlocal
