$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$folder = Join-Path (Split-Path $PSScriptRoot -Parent) 'extension\icons'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$canvas = New-Object Drawing.Bitmap(512, 512)
$graphics = [Drawing.Graphics]::FromImage($canvas)
try {
    $graphics.SmoothingMode = 'AntiAlias'
    $graphics.ScaleTransform(4, 4)
    $brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#4e3979'))
    $graphics.FillEllipse($brush,8,8,112,112)
    $left = New-Object Drawing.Drawing2D.GraphicsPath
    $left.AddBezier(49,31,31,34,24,47,24,64)
    $left.AddBezier(24,64,24,81,31,94,49,97)
    $right = New-Object Drawing.Drawing2D.GraphicsPath
    $right.AddBezier(79,31,97,34,104,47,104,64)
    $right.AddBezier(104,64,104,81,97,94,79,97)
    $cream = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#fff6e9'),10)
    $amber = New-Object Drawing.Pen([Drawing.ColorTranslator]::FromHtml('#efae68'),10)
    foreach ($pen in @($cream,$amber)) { $pen.StartCap='Round';$pen.EndCap='Round';$pen.LineJoin='Round' }
    $graphics.DrawPath($cream,$left);$graphics.DrawPath($amber,$right)
    $dot = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#d4bdf3'))
    $graphics.FillEllipse($dot,53,53,22,22)
    foreach ($size in @(16,32,48,128)) {
        $icon = New-Object Drawing.Bitmap($size,$size)
        $scaled = [Drawing.Graphics]::FromImage($icon)
        try {
            $scaled.InterpolationMode = 'HighQualityBicubic'
            $scaled.PixelOffsetMode = 'HighQuality'
            if ($size -eq 128) {
                $scaled.DrawImage($canvas,(New-Object Drawing.Rectangle(16,16,96,96)),28,28,456,456,[Drawing.GraphicsUnit]::Pixel)
            } else { $scaled.DrawImage($canvas,0,0,$size,$size) }
            $icon.Save((Join-Path $folder "icon$size.png"),[Drawing.Imaging.ImageFormat]::Png)
        } finally { $scaled.Dispose(); $icon.Dispose() }
    }
    $dot.Dispose();$amber.Dispose();$cream.Dispose();$right.Dispose();$left.Dispose();$brush.Dispose()
} finally { $graphics.Dispose(); $canvas.Dispose() }
Write-Host 'Extension icons generated: 16, 32, 48 and 128 pixels'
