$ErrorActionPreference = "Stop"
function Check($name, [scriptblock]$command) {
  Write-Host "\n=== $name ==="
  & $command
  if ($LASTEXITCODE -ne 0) { throw "$name failed: $LASTEXITCODE" }
}
Set-Location (Join-Path $PSScriptRoot "..")
Check "Python syntax" { python -m compileall -q mt5-bridge }
Check "Python regression" { python -m unittest discover -s mt5-bridge -p "test_*.py" -v }
Check "Dependencies" { npm install }
Check "TypeScript" { npx tsc --noEmit }
Check "Production build" { npm run build }
Write-Host "Local regression passed. MT5 broker integration still requires demo verification."
