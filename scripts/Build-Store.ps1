[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$source = Join-Path $root 'extension'
$stage = Join-Path $root 'release\webstore-stage'
if (Test-Path -LiteralPath $stage) {
    $resolved = [IO.Path]::GetFullPath($stage)
    $expected = [IO.Path]::GetFullPath((Join-Path $root 'release\webstore-stage'))
    if ($resolved -ne $expected -or !$resolved.StartsWith([IO.Path]::GetFullPath($root).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe store staging path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
New-Item -ItemType Directory -Path $stage, (Join-Path $stage 'icons') -Force | Out-Null
Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Name -ne 'package.json' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $stage }
Get-ChildItem -LiteralPath (Join-Path $source 'icons') -Filter '*.png' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage 'icons') }
$manifest = Get-Content -LiteralPath (Join-Path $stage 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest.PSObject.Properties.Remove('key')
[IO.File]::WriteAllText((Join-Path $stage 'manifest.json'), ($manifest | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
$zip = Join-Path $root 'release\GoodbyeDPI-Companion-WebStore.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    if (@($archive.Entries | Where-Object { $_.FullName -eq 'manifest.json' }).Count -ne 1) { throw 'Store ZIP requires a root manifest' }
    if (@($archive.Entries | Where-Object { $_.FullName -match '\.(exe|sys|dll|cmd|ps1)$' }).Count) { throw 'Native components must not be included in store ZIP' }
} finally { $archive.Dispose() }
$hashes = @{}
Get-ChildItem -LiteralPath (Join-Path $root 'release') -File | Where-Object { $_.Extension -in @('.zip', '.exe') } | ForEach-Object { $hashes[$_.Name] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
$hashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'release\SHA256SUMS.json') -Encoding UTF8
Write-Host ('Store ZIP ready: ' + $zip)
