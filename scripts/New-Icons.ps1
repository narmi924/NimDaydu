$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore

$iconDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'extension/public'
[xml]$svg = Get-Content -Raw (Join-Path $iconDir 'icon.svg')
foreach ($size in @(16, 32, 48, 128)) {
    $visual = [Windows.Media.DrawingVisual]::new()
    $drawing = $visual.RenderOpen()
    $drawing.PushTransform([Windows.Media.ScaleTransform]::new($size / 128, $size / 128))
    foreach ($path in $svg.svg.path) {
        $brush = [Windows.Media.BrushConverter]::new().ConvertFromString($path.fill)
        $drawing.DrawGeometry($brush, $null, [Windows.Media.Geometry]::Parse($path.d))
    }
    $drawing.Pop()
    $drawing.Close()

    $bitmap = [Windows.Media.Imaging.RenderTargetBitmap]::new(
        $size, $size, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($visual)
    $png = [Windows.Media.Imaging.PngBitmapEncoder]::new()
    $png.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [IO.File]::Create((Join-Path $iconDir "icon$size.png"))
    try { $png.Save($stream) } finally { $stream.Dispose() }
}
Write-Output 'Generated four NimDaydu icons from icon.svg.'
