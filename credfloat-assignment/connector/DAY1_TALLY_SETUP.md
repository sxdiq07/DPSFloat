# Day 1 — Tally ODBC Setup Guide (Windows)

Follow this start to finish. Budget 60–90 minutes for a clean run. If something breaks, the Troubleshooting section at the end covers the top 8 things that go wrong.

---

## Pre-flight checklist

- [ ] Windows PC (Windows 10/11)
- [ ] Admin rights on your laptop
- [ ] Tally Prime 7.0 installer downloaded from https://tallysolutions.com
- [ ] Python 3.11+ installed (check: `python --version` in Command Prompt)
- [ ] Manager's Tally backup file (`.001` extension usually, sometimes a folder)

---

## Step 1 — Install Tally Prime 7.0

1. Run the installer as Administrator (right-click → Run as administrator)
2. Install to the default location (`C:\Program Files\TallyPrime`)
3. Launch Tally Prime. You'll see the Gateway of Tally / Company selection screen
4. Choose **Work in Educational Mode** for dev setup (no license needed). Production will use the firm's actual license.

---

## Step 2 — Restore the backup

1. In Tally Prime, from Gateway of Tally → press `Alt+F3` (Company Info) → **Restore**
2. Source: navigate to where your manager's backup file is stored
3. Destination: default is fine (`C:\Users\Public\TallyPrime\Data`)
4. Select the companies listed in the backup → Enter to restore
5. Back at Gateway of Tally → press `F1` → **Select Company** → pick the restored company

**Sanity check:** Gateway of Tally → `Display More Reports` → `Account Books` → `Ledger` — you should see the firm's ledger list. If yes, the backup is loaded correctly.

---

## Step 3 — Enable Tally ODBC Server

This is where most people trip up. Exact menu path in Tally Prime 7.0:

1. From Gateway of Tally, press `F1` (Help)
2. Press `F12` (Configuration) → or navigate to **Settings** → **Connectivity**
3. Find **Client/Server configuration**
4. Set:
   - `TallyPrime is acting as`: **Both**
   - `Enable ODBC`: **Yes**
   - `Port`: `9000` (default)
5. Press `Ctrl+A` to save

**Verify it's running:** open Command Prompt → `netstat -an | findstr 9000`. You should see Tally listening on port 9000. If nothing shows, ODBC isn't actually enabled — repeat the steps.

> **Important:** keep Tally Prime **open and running** whenever you run the connector. If Tally closes, the ODBC port dies with it. This is why the connector eventually runs as a Windows scheduled task on a machine where Tally stays open 24/7.

---

## Step 4 — Install the Tally ODBC Driver

The Tally ODBC driver is installed **separately** from Tally itself. Even if Tally is working, the ODBC driver may not be set up yet.

1. Open Command Prompt as Administrator
2. Navigate to your Tally installation: `cd "C:\Program Files\TallyPrime"`
3. Run: `TallyPrime.exe /INSTALLODBC` (or `Install_ODBC.exe` if that's what's in the folder)
4. A small installer window will appear — click **Install**
5. The driver registers itself with Windows

**Bitness match matters:** if your Python is 64-bit (most common today), you need the 64-bit Tally ODBC driver. Check Python bitness:
```
python -c "import platform; print(platform.architecture())"
```
If it says `64bit`, you need the 64-bit ODBC driver. Tally Prime 7.0 installs a 64-bit driver by default.

---

## Step 5 — Configure the ODBC Data Source (DSN)

1. Windows Search → type `ODBC Data Sources (64-bit)` → open it (important: 64-bit, not 32-bit)
2. Go to the **System DSN** tab (not User DSN)
3. Click **Add**
4. Select **Tally ODBC Driver** from the list → Finish
5. In the configuration window that opens:
   - **Data Source Name:** `TallyODBC_9000`  *(match this exactly — the connector looks for this name)*
   - **Description:** `CredFloat Tally connection`
   - **Server:** `localhost`
   - **Port:** `9000`
6. Click **Test Connection** — if it says "Test successful," you're done. If it fails, Tally isn't running or ODBC isn't enabled.
7. OK to save

**Verify in ODBC Admin:** the System DSN tab should now list `TallyODBC_9000` with driver `Tally ODBC Driver`.

---

## Step 6 — Run the connection test script

Before running the full connector, run the tiny test script provided (`test_tally_connection.py`). It checks four things in sequence and tells you exactly what's wrong if any step fails.

```bash
cd credfloat-assignment\connector
pip install -r requirements.txt
python test_tally_connection.py
```

Expected output:
```
=== Test 1: Connecting to TallyODBC_9000... ===
✓ Connected to Tally ODBC

=== Test 2: Listing companies... ===
✓ Found 1 company(ies):
    - [Manager's company name from backup]

=== Test 3: Inspecting Ledger columns... ===
✓ Ledger table has 47 columns:
    - $Name
    - $Parent
    - ...

=== Test 4: Counting debtor ledgers... ===
✓ Found 23 ledgers under 'Sundry Debtors'

=== All tests passed! ===
```

**Save this output.** Copy the Ledger columns list — you'll need it in Step 7 to extend the main connector with phone/email fields if they're available.

---

## Step 7 — Run the main connector (dry-run mode)

```bash
python tally_connector.py
```

With `DRY_RUN=true` in `.env`, it prints the full payload instead of posting anywhere. Screenshot this output — **this is your Day 1 deliverable to send the manager.**

---

## Day 1 deliverable for manager

Send a short WhatsApp message with:
1. Screenshot of the test script all four ✓ passing
2. Screenshot of the connector's dry-run output showing real party names and closing balances
3. Message text:

> Bhai, Day 1 done. Tally 7.0 installed, backup restored, ODBC working, connector pulling debtor data from [company name]. Found [N] debtors with outstanding. Tomorrow I spin up Supabase + Next.js and get the data flowing to cloud. Attaching screenshots.

This does three things: proves you can actually execute (not just write docs), shows you're moving fast, and sets up tomorrow's expectation.

---

## Troubleshooting — the top 8 things that go wrong

### 1. "Data source name not found and no default driver specified"
Your DSN isn't configured, or you're using 32-bit ODBC Admin to configure a DSN for 64-bit Python. Open **ODBC Data Sources (64-bit)** specifically, not the generic one.

### 2. "[Microsoft][ODBC Driver Manager] Driver's SQLAllocHandle on SQL_HANDLE_ENV failed"
Bitness mismatch. Your Python is 64-bit but you installed the 32-bit Tally ODBC driver (or vice versa). Reinstall the matching driver.

### 3. Connection times out / "Connection refused"
Tally isn't running, or Tally's ODBC server isn't enabled. Open Tally → F1 → Connectivity → verify ODBC is `Yes`. Run `netstat -an | findstr 9000` in Command Prompt to confirm Tally is listening.

### 4. "No Company Loaded"
You need to have a company open in Tally — not just Tally running. Go to Gateway of Tally → Select Company → pick the restored one.

### 5. `SELECT $Name FROM Company` returns empty
ODBC can't see the loaded company. This usually means Tally is in a weird state — quit Tally completely, reopen, load the company, try again.

### 6. `$Parent = 'Sundry Debtors'` returns 0 rows
The firm may have restructured debtor groups. Run this to find their actual debtor group names:
```sql
SELECT $Name FROM Group WHERE $Parent = 'Sundry Debtors' OR $Name LIKE '%Debtor%'
```
Then use those group names in the connector's WHERE clause.

### 7. Unicode errors on party names
Indian company names often have Devanagari characters or special symbols. In the connector, when connecting, add `charset='utf8'`:
```python
pyodbc.connect(f"DSN={DSN}", timeout=10, autocommit=True)
```
If still broken, set the Windows system locale to support Unicode.

### 8. `pip install pyodbc` fails on Windows
You need Microsoft C++ Build Tools. Install from: https://visualstudio.microsoft.com/visual-cpp-build-tools/ → select "Desktop development with C++" workload. Retry pip install.

---

## When you're stuck

- Share the exact error message (screenshot of the terminal)
- Run `python test_tally_connection.py` and share whichever test fails
- 90% of ODBC issues are one of: (a) Tally not running, (b) wrong DSN name, (c) bitness mismatch

Keep Tally Prime running in the background while you develop — every connector test needs it up.
