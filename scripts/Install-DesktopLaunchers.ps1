$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $PSScriptRoot 'desktop'
$buildDir = Join-Path $projectDir '.nimdaydu\launchers'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
if (-not (Test-Path -LiteralPath $desktop -PathType Container)) { throw 'Windows desktop folder not found.' }
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
[IO.Directory]::CreateDirectory($buildDir) | Out-Null
[IO.File]::WriteAllText((Join-Path $buildDir 'project.txt'), $projectDir)
$buttons = [ordered]@{ start = 'NimDaydu 启动.exe'; stop = 'NimDaydu 关闭.exe' }
Push-Location -LiteralPath $buildDir
try {
    foreach ($action in $buttons.Keys) {
        $icon = Join-Path $assets "$action.ico"
        & $compiler /nologo /target:winexe /optimize+ /codepage:65001 "/define:$($action.ToUpperInvariant())" `
            /resource:project.txt,project.txt "/win32icon:$icon" "/out:$action.exe" (Join-Path $assets 'Launcher.cs')
        if ($LASTEXITCODE -ne 0) { throw "Could not build the $action launcher." }
    }
    foreach ($action in $buttons.Keys) {
        Copy-Item -LiteralPath "$action.exe" -Destination (Join-Path $desktop $buttons[$action])
    }
} finally { Pop-Location }
Write-Host "NimDaydu desktop launchers installed in $desktop"
