$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$folder = Join-Path (Split-Path $PSScriptRoot -Parent) 'extension\icons'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$canvas = New-Object Drawing.Bitmap(512, 512)
$graphics = [Drawing.Graphics]::FromImage($canvas)
try {
    $graphics.SmoothingMode = 'AntiAlias'
    $graphics.ScaleTransform(4, 4)
    $tile = New-Object Drawing.Drawing2D.GraphicsPath
    foreach ($arc in @(@(8,8,56,56,180,90),@(64,8,56,56,270,90),@(64,64,56,56,0,90),@(8,64,56,56,90,90))) {
        $tile.AddArc([single]$arc[0],[single]$arc[1],[single]$arc[2],[single]$arc[3],[single]$arc[4],[single]$arc[5])
    }
    $tile.CloseFigure()
    $brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#143348'))
    $border = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#63899b'),1.5)
    $graphics.FillPath($brush,$tile); $graphics.DrawPath($border,$tile)
    $shield = New-Object Drawing.Drawing2D.GraphicsPath
    $shield.AddLine(64,27,94,39); $shield.AddLine(94,39,94,64)
    $shield.AddBezier(94,64,94,85,78,99,64,106)
    $shield.AddBezier(64,106,50,99,34,85,34,64)
    $shield.AddLine(34,64,34,39); $shield.CloseFigure()
    $mint = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#70efc4'),8)
    $mint.LineJoin = 'Round'; $graphics.DrawPath($mint,$shield)
    $arrow = New-Object Drawing.Pen([Drawing.Color]::White,8)
    $arrow.StartCap = 'Round'; $arrow.EndCap = 'Round'; $arrow.LineJoin = 'Round'
    $graphics.DrawLine($arrow,45,64,84,64)
    $points = [Drawing.PointF[]]@((New-Object Drawing.PointF(72,52)),(New-Object Drawing.PointF(84,64)),(New-Object Drawing.PointF(72,76)))
    $graphics.DrawLines($arrow,$points)
    foreach ($size in @(16,32,48,128)) {
        $icon = New-Object Drawing.Bitmap($size,$size)
        $scaled = [Drawing.Graphics]::FromImage($icon)
        try {
            $scaled.InterpolationMode = 'HighQualityBicubic'
            $scaled.PixelOffsetMode = 'HighQuality'
            $scaled.DrawImage($canvas,0,0,$size,$size)
            $icon.Save((Join-Path $folder "icon$size.png"),[Drawing.Imaging.ImageFormat]::Png)
        } finally { $scaled.Dispose(); $icon.Dispose() }
    }
    $arrow.Dispose(); $mint.Dispose(); $shield.Dispose(); $border.Dispose(); $brush.Dispose(); $tile.Dispose()
} finally { $graphics.Dispose(); $canvas.Dispose() }
Write-Host 'Extension icons generated: 16, 32, 48 and 128 pixels'
