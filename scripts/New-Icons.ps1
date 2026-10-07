$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'extension/public'
foreach ($iconSize in @(16,32,48,128)) {
    $bitmap = New-Object Drawing.Bitmap($iconSize,$iconSize)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.ScaleTransform(($iconSize/128.0),($iconSize/128.0))
    $background = New-Object Drawing.Drawing2D.GraphicsPath
    $background.AddArc(0,0,50,50,180,90)
    $background.AddArc(78,0,50,50,270,90)
    $background.AddArc(78,78,50,50,0,90)
    $background.AddArc(0,78,50,50,90,90)
    $background.CloseFigure()
    $mint = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(229,230,233))
    $ink = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(25,26,29))
    $graphics.FillPath($mint,$background)
    $font = New-Object Drawing.Font('Segoe UI',80,[Drawing.FontStyle]::Bold,[Drawing.GraphicsUnit]::Pixel)
    $graphics.DrawString('N',$font,$ink,19,11)
    $graphics.FillEllipse($ink,100,91,12,12)
    $bitmap.Save((Join-Path $iconDir "icon$iconSize.png"),[Drawing.Imaging.ImageFormat]::Png)
    $font.Dispose(); $mint.Dispose(); $ink.Dispose(); $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
Write-Output 'Generated four NimDaydu icons.'
