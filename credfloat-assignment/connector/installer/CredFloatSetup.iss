; CredFloat Connector — Inno Setup installer.
; Build: iscc installer\CredFloatSetup.iss   (or run build_installer.bat)
; Output: installer\Output\CredFloatSetup.exe

#define MyAppName        "CredFloat Connector"
#define MyAppVersion     "1.0.0"
#define MyAppPublisher   "DPS & Co"
#define MyAppExeName     "credfloat-connector.exe"

[Setup]
AppId={{C2F1B5A8-0E8E-4A0E-8A2D-0FD0B8A5E2B1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\CredFloat
DefaultGroupName=CredFloat
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=CredFloatSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart";   Description: "Start CredFloat Connector when I sign in to Windows"; GroupDescription: "Startup:"; Flags: unchecked
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}";        Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#MyAppName}";  Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; Per-user autostart on login. HKCU survives without admin rights.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "CredFloatConnector"; ValueData: """{app}\{#MyAppExeName}"""; \
  Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#MyAppExeName}"; \
  Description: "Launch {#MyAppName}"; \
  Flags: nowait postinstall skipifsilent

[UninstallDelete]
; %APPDATA%\CredFloat\* — config + logs. Keep on uninstall by commenting these out.
Type: filesandordirs; Name: "{userappdata}\CredFloat"
