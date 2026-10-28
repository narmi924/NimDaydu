param([switch]$OpenPairing)
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$serviceDir = Join-Path $projectDir 'local-service'
$pythonPath = Join-Path $serviceDir '.venv\Scripts\python.exe'
$stateDir = Join-Path $projectDir '.nimdaydu'
$env:PYTHONUTF8 = '1'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run setup.ps1 first.' }
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
try { $health = Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2 } catch { $health = $null }
if ($health) {
    if ($health.app -ne 'NimDaydu') { throw 'Port 8765 is occupied by another application.' }
    if (-not $health.ready) { throw 'NimDaydu is running but its model is not ready. Read .nimdaydu/service.err.log, then stop and restart.' }
    Write-Host 'NimDaydu is already running.'
} else {
    $process = Start-Process -FilePath $pythonPath -ArgumentList @('-m', 'uvicorn', 'nimdaydu.app:app', '--host', '127.0.0.1', '--port', '8765', '--ws-max-size', '262144', '--no-access-log') -WorkingDirectory $serviceDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'service.out.log') -RedirectStandardError (Join-Path $stateDir 'service.err.log')
    @{ pid = $process.Id; startTime = $process.StartTime.ToUniversalTime().ToString('o'); executable = $pythonPath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir 'process.json') -Encoding utf8
    # Loading the translator on the GPU the first time also compiles its shaders.
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 300
        $process.Refresh()
        if ($process.HasExited) { throw 'Service exited. Read .nimdaydu/service.err.log.' }
        try { $health = Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 1 } catch { continue }
        if ($health.app -eq 'NimDaydu' -and $health.ready) { break }
        if ($health.error) { throw $health.error }
    }
    if (-not $health.ready) { throw 'Service startup timed out. Read .nimdaydu/service.err.log.' }
    if ($health.processId) {
        $serverProcess = Get-Process -Id $health.processId
        @{ pid = $serverProcess.Id; startTime = $serverProcess.StartTime.ToUniversalTime().ToString('o'); executable = $serverProcess.Path } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir 'process.json') -Encoding utf8
    }
    Write-Host "NimDaydu is ready. Speech: $($health.model). Translation: $($health.translationEngine). Audio stays on this computer."
}
Write-Host 'The Chrome extension connects automatically. No pairing code is needed.'
if ($OpenPairing) { Start-Process 'http://127.0.0.1:8765/pairing' }
