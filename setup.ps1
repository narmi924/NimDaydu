param([ValidateSet('small', 'medium', 'hybrid')][string]$Model = 'hybrid')
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$env:PYTHONUTF8 = '1'
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22+ first: https://nodejs.org/' }
Push-Location (Join-Path $projectDir 'local-service')
try {
    & uv sync --python 3.12 --frozen
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency setup failed.' }
    $draftModel = if ($Model -eq 'hybrid') { 'small' } else { $Model }
    & '.\.venv\Scripts\python.exe' download_models.py --models $draftModel
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Re-run setup.ps1 to resume verified downloads.' }
    if ($Model -eq 'hybrid') {
        & '.\.venv\Scripts\python.exe' download_refiner.py
        if ($LASTEXITCODE -ne 0) { throw 'Parakeet model download failed.' }
    }
    & '.\.venv\Scripts\python.exe' download_translation.py
    if ($LASTEXITCODE -ne 0) { throw 'Offline translation model download failed.' }
    & '.\.venv\Scripts\python.exe' download_llm.py
    if ($LASTEXITCODE -ne 0) { throw 'Local translation model download failed. Re-run setup.ps1 to resume.' }
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
$selectionPath = Join-Path $projectDir '.nimdaydu\asr-model.json'
if ($PSBoundParameters.ContainsKey('Model') -or -not (Test-Path -LiteralPath $selectionPath)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $selectionPath) | Out-Null
    @{ model = $Model } | ConvertTo-Json | Set-Content -LiteralPath $selectionPath -Encoding utf8
}
