$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not $env:MT5_BRIDGE_KEY -or $env:MT5_BRIDGE_KEY.Length -lt 32) { throw "Configure MT5_BRIDGE_KEY securely before starting." }
if ($env:MT5_EXECUTION_LOGIN -notmatch '^\d{1,15}$' -or -not $env:MT5_EXECUTION_SERVER) { throw "Configure the exact demo login and server." }
$env:MT5_DEMO_EXECUTION = "false"
$env:MT5_AGENT_EXECUTION = "false"
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    py -3.12 -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Virtual environment creation failed." }
}
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
& $python -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
& $python -c "import MetaTrader5 as m, os, sys; ok=m.initialize(timeout=15000); a=m.account_info() if ok else None; t=m.terminal_info() if ok else None; valid=bool(a and t and t.connected and a.trade_mode==m.ACCOUNT_TRADE_MODE_DEMO and str(a.login)==os.environ['MT5_EXECUTION_LOGIN'] and a.server==os.environ['MT5_EXECUTION_SERVER']); m.shutdown(); print('Demo terminal verified' if valid else 'Demo terminal verification failed'); sys.exit(0 if valid else 1)"
if ($LASTEXITCODE -ne 0) { throw "Connect the dedicated MT5 terminal to the allowlisted demo account." }
& $python -m uvicorn main:app --host 127.0.0.1 --port 8765 --workers 1
if ($LASTEXITCODE -ne 0) { throw "Bridge stopped with an error." }
