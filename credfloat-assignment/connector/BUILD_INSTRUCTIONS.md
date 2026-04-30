# CredFloat Connector — Build & Install

End-to-end flow: produce a single `CredFloatSetup.exe` that any client's
accountant can run on their Windows PC. They double-click, paste their API
key, and we start receiving Tally data.

## One-time setup on the build machine

1. Install Python 3.11+ (64-bit) — match Tally ODBC bitness.
2. Install Inno Setup 6: <https://jrsoftware.org/isinfo.php>
3. From the `connector/` folder:
   ```cmd
   pip install -r requirements.txt
   ```

## Build the connector .exe

```cmd
build_exe.bat
```

Produces `dist\credfloat-connector.exe`. This is the tray app — runs the
sync loop, opens a setup dialog on first launch, polls Tally on a schedule.

## Build the installer

```cmd
build_installer.bat
```

Produces `installer\Output\CredFloatSetup.exe`. This is the artifact you
hand to clients (email, download link, USB).

## What the client sees on install

1. Run `CredFloatSetup.exe`. **Windows SmartScreen will warn** because the
   binary isn't code-signed yet — they click *More info → Run anyway*.
   Buying an EV cert removes the warning; punt to v2 unless trust is a
   blocker for onboarding.
2. Installer asks two checkboxes: "Start on login" and "Desktop shortcut".
3. On finish, the connector launches into the system tray (look for the
   blue C icon by the clock).
4. A setup dialog pops up. They paste:
   - API URL (default: production CredFloat URL)
   - API Key (issued from the firm's CredFloat dashboard)
   - Tally DSN (default: `TallyODBC_9000`)
5. Click Save. Sync runs every 30 minutes; "Sync now" forces it.

## What the user must do once in Tally

(Same as the existing `DAY1_TALLY_SETUP.md`)
- Tally Prime running with the company loaded
- ODBC server **ON** (F1 → Settings → Connectivity → ODBC Server, port 9000)
- Windows ODBC DSN named `TallyODBC_9000` configured (64-bit Data Sources)

## File layout that ships to the client

```
%ProgramFiles%\CredFloat\
  credfloat-connector.exe        (or %LOCALAPPDATA% if non-admin install)

%APPDATA%\CredFloat\
  config.json                    (api_url, api_key, dsn, interval)
  state.json                     (last sync timestamp + status)
  logs\connector.log             (rotating, 2 MB × 4 files)
```

## Updating the connector

Bump `MyAppVersion` in `installer\CredFloatSetup.iss`, rebuild the .exe,
rebuild the installer, ship the new `CredFloatSetup.exe`. Inno Setup's
`AppId` GUID is stable so it upgrades in place — config and logs survive.
