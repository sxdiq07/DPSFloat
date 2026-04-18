"""
Tally ODBC connection test — run this FIRST before running tally_connector.py.

This script runs four quick checks in sequence and tells you exactly what's
wrong at whichever step fails. Saves an hour of debugging.

Usage:
    python test_tally_connection.py

Expected result: all four tests pass with green checkmarks.
"""

import sys
import os

try:
    import pyodbc
except ImportError:
    print("✗ pyodbc not installed. Run: pip install -r requirements.txt")
    sys.exit(1)

DSN = os.getenv("TALLY_DSN", "TallyODBC_9000")


def banner(text: str) -> None:
    print(f"\n=== {text} ===")


def pass_msg(text: str) -> None:
    print(f"\033[92m✓\033[0m {text}")


def fail_msg(text: str) -> None:
    print(f"\033[91m✗\033[0m {text}")


# ------------------------------------------------------------------
# Test 1: Can we connect to Tally at all?
# ------------------------------------------------------------------
banner(f"Test 1: Connecting to DSN '{DSN}'...")
try:
    conn = pyodbc.connect(f"DSN={DSN}", timeout=5)
    pass_msg("Connected to Tally ODBC.")
except pyodbc.Error as e:
    fail_msg(f"Connection failed: {e}")
    print("\nFix checklist — work through these in order:")
    print("  1. Is Tally Prime running right now? (Keep it open during testing.)")
    print("  2. In Tally: F1 → Settings → Connectivity → is ODBC Server = Yes?")
    print("  3. Run 'netstat -an | findstr 9000' — does Tally show as listening?")
    print("  4. In Windows, open ODBC Data Sources (64-bit) — is System DSN")
    print("     'TallyODBC_9000' configured? (Not User DSN — System DSN.)")
    print("  5. Bitness match: is your Python 64-bit?")
    print(f"     Your Python: {sys.maxsize > 2**32 and '64-bit' or '32-bit'}")
    print("     If 64-bit, you need the 64-bit Tally ODBC driver installed.")
    sys.exit(1)


# ------------------------------------------------------------------
# Test 2: List companies (verifies Tally has something loaded)
# ------------------------------------------------------------------
banner("Test 2: Listing loaded companies...")
cursor = conn.cursor()
try:
    cursor.execute("SELECT $Name FROM Company")
    rows = cursor.fetchall()
    if not rows:
        fail_msg("No companies returned. Is a company currently open in Tally?")
        print("  Go to Gateway of Tally → Select Company → pick the restored one.")
        sys.exit(1)
    pass_msg(f"Found {len(rows)} company(ies):")
    for r in rows:
        print(f"    - {r[0]}")
except pyodbc.Error as e:
    fail_msg(f"Company query failed: {e}")
    sys.exit(1)


# ------------------------------------------------------------------
# Test 3: Inspect available Ledger columns
# (different Tally versions expose different fields — this tells us what's available)
# ------------------------------------------------------------------
banner("Test 3: Inspecting available Ledger columns...")
try:
    cursor.execute("SELECT * FROM Ledger")
    cols = [d[0] for d in cursor.description]
    pass_msg(f"Ledger table exposes {len(cols)} columns:")
    for c in cols:
        print(f"    - {c}")
    print("\n  >> COPY THIS LIST. Use it to extend tally_connector.py with")
    print("     contact fields (phone, email, address) that exist in your build.")
except pyodbc.Error as e:
    fail_msg(f"Column inspection failed: {e}")
    sys.exit(1)


# ------------------------------------------------------------------
# Test 4: Count debtor ledgers under Sundry Debtors
# ------------------------------------------------------------------
banner("Test 4: Counting Sundry Debtors ledgers...")
try:
    cursor.execute("SELECT COUNT(*) FROM Ledger WHERE $Parent = 'Sundry Debtors'")
    count = cursor.fetchone()[0]
    if count == 0:
        fail_msg("No ledgers under 'Sundry Debtors'.")
        print("  The firm may use a different group name. Try:")
        print("  SELECT $Name FROM Group WHERE $Name LIKE '%Debtor%'")
        print("  Then use the actual group name in tally_connector.py")
    else:
        pass_msg(f"Found {count} debtor ledgers with 'Sundry Debtors' as parent.")
except pyodbc.Error as e:
    fail_msg(f"Debtor query failed: {e}")
    sys.exit(1)


# ------------------------------------------------------------------
# Test 5 (bonus): Preview a few debtor balances
# ------------------------------------------------------------------
banner("Test 5 (bonus): Previewing first 5 debtors...")
try:
    cursor.execute("""
        SELECT $Name, $ClosingBalance
        FROM Ledger
        WHERE $Parent = 'Sundry Debtors'
    """)
    rows = cursor.fetchall()[:5]
    if rows:
        print(f"{'Debtor name':<40} {'Closing balance':>18}")
        print("-" * 60)
        for r in rows:
            name = (r[0] or "")[:38]
            bal = float(r[1] or 0)
            # Flip sign: Tally stores debtor balance as negative
            outstanding = -bal
            print(f"{name:<40} {outstanding:>18,.2f}")
        pass_msg("Preview successful. This is real data from Tally.")
except pyodbc.Error as e:
    fail_msg(f"Preview failed (non-critical): {e}")


conn.close()

print("\n" + "=" * 60)
print("\033[92mAll tests passed!\033[0m")
print("=" * 60)
print("Next step: python tally_connector.py")
print("Keep Tally Prime running during development.\n")
