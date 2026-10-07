$ErrorActionPreference = 'Stop'
$recordPath = Join-Path $PSScriptRoot '.nimdaydu\process.json'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Host 'No NimDaydu process record.'; return }
$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
$process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
if (-not $process) { Write-Host 'NimDaydu is already stopped.'; return }
$recordedStart = if ($record.startTime -is [DateTime]) { $record.startTime.ToUniversalTime() } else { [DateTime]::Parse($record.startTime, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() }
if ($process.Path -ne $record.executable -or [Math]::Abs(($process.StartTime.ToUniversalTime() - $recordedStart).TotalSeconds) -gt 1) {
    throw 'Process identity does not match this project; refusing to stop a different application.'
}
# Windows venv's python.exe may be a launcher for the real interpreter.
# Stop only its verified NimDaydu child, not an arbitrary process tree.
$children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($process.Id)" | Where-Object { $_.CommandLine -like '*-m uvicorn nimdaydu.app:app --host 127.0.0.1 --port 8765*' -and $_.Name -eq 'python.exe' }
foreach ($child in $children) { Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }
Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
Write-Host 'NimDaydu local service stopped.'
