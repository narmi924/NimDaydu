param([ValidateSet('small', 'medium')][string]$Model = 'small')
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$env:PYTHONUTF8 = '1'
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22+ first: https://nodejs.org/' }
Push-Location (Join-Path $projectDir 'local-service')
try {
    & uv sync --python 3.12 --frozen
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency setup failed.' }
    & '.\.venv\Scripts\python.exe' download_models.py --models $Model
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Re-run setup.ps1 to resume verified downloads.' }
    & '.\.venv\Scripts\python.exe' download_translation.py
    if ($LASTEXITCODE -ne 0) { throw 'Offline translation model download failed.' }
} finally { Pop-Location }
Push-Location (Join-Path $projectDir 'extension')
try {
    & npm.cmd ci --registry https://registry.npmjs.org
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Retrying with a project-local npm version (no global install).'
        & npx.cmd --yes npm@12.2.0 ci --registry https://registry.npmjs.org
        if ($LASTEXITCODE -ne 0) { throw 'Extension dependency setup failed.' }
    }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Extension build failed.' }
} finally { Pop-Location }
Write-Host 'Setup complete. Run start.ps1, then load extension/.output/chrome-mv3 in chrome://extensions.'
if ($Model -ne 'small') { Write-Host 'To use medium, set NIMDAYDU_MODEL=medium in project .env and restart the service.' }
