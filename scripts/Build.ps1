[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$release = Join-Path $root 'release'
$bundle = Join-Path $release 'GoodbyeDPI-Companion-Windows'
if (Test-Path -LiteralPath $bundle) {
    $resolvedBundle = [IO.Path]::GetFullPath($bundle)
    $expectedBundle = [IO.Path]::GetFullPath((Join-Path $root 'release\GoodbyeDPI-Companion-Windows'))
    if ($resolvedBundle -ne $expectedBundle -or !$resolvedBundle.StartsWith([IO.Path]::GetFullPath($root).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe build staging path' }
    Remove-Item -LiteralPath $resolvedBundle -Recurse -Force
}
New-Item -ItemType Directory -Path $release, $bundle, (Join-Path $bundle 'engine') -Force | Out-Null
$archive = Join-Path $root 'vendor\goodbyedpi-0.2.3rc3-2.zip'
$expected = '37F96B32D050DADCC930A639EBA68E1CCD57ED5C04A5F77DFCA908F01905A4C5'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) { throw 'Official dependency archive hash mismatch' }
$unpack = Join-Path $release 'official-unpacked'
Expand-Archive -LiteralPath $archive -DestinationPath $unpack -Force
$official = Join-Path $unpack 'goodbyedpi-0.2.3rc3-2'
foreach ($name in @('x86', 'x86_64', 'licenses')) {
    Copy-Item -LiteralPath (Join-Path $official $name) -Destination (Join-Path $bundle 'engine') -Recurse -Force
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (!(Test-Path -LiteralPath $compiler)) { throw 'Install Microsoft .NET Framework 4.8 before building' }
& $compiler /nologo /target:exe /platform:anycpu /optimize+ /warnaserror+ /r:System.ServiceProcess.dll /r:System.Web.Extensions.dll "/out:$(Join-Path $bundle 'Companion.exe')" (Join-Path $root 'native\Companion.cs') (Join-Path $root 'native\BuildInfo.cs')
if ($LASTEXITCODE -ne 0) { throw 'C# compilation failed' }
foreach ($name in @('Install.ps1', 'Install.cmd', 'Uninstall.ps1', 'Uninstall.cmd')) { Copy-Item -LiteralPath (Join-Path $root "installer\$name") -Destination $bundle -Force }
Copy-Item -LiteralPath (Join-Path $root 'extension\public_suffix_list.dat') -Destination $bundle -Force
Copy-Item -LiteralPath (Join-Path $root 'extension-id.txt') -Destination $bundle -Force
Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination $bundle -Force
Copy-Item -LiteralPath (Join-Path $root 'THIRD-PARTY.md') -Destination $bundle -Force
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination $bundle -Force
Copy-Item -LiteralPath (Join-Path $root 'VALIDATION.md') -Destination $bundle -Force
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination (Join-Path $root 'extension') -Force
Copy-Item -LiteralPath (Join-Path $root 'THIRD-PARTY.md') -Destination (Join-Path $root 'extension') -Force
$hashes = @{}
Get-ChildItem -LiteralPath $bundle -Recurse -File | Where-Object { $_.Name -ne 'checksums.json' } | ForEach-Object {
    $relative = $_.FullName.Substring($bundle.Length + 1)
    $hashes[$relative] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
}
$hashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundle 'checksums.json') -Encoding UTF8
Compress-Archive -LiteralPath $bundle -DestinationPath (Join-Path $release 'GoodbyeDPI-Companion-Windows.zip') -Force
& $compiler /nologo /target:winexe /platform:anycpu /codepage:65001 /optimize+ /warnaserror+ /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Web.Extensions.dll "/resource:$(Join-Path $release 'GoodbyeDPI-Companion-Windows.zip'),Payload.zip" "/out:$(Join-Path $release 'GoodbyeDPI-Companion-Setup.exe')" (Join-Path $root 'native\Setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'Setup compilation failed' }
Compress-Archive -LiteralPath (Join-Path $root 'extension') -DestinationPath (Join-Path $release 'GoodbyeDPI-Companion-Extension.zip') -Force
$zips = @{}
Get-ChildItem -LiteralPath $release -File | Where-Object { $_.Extension -in @('.zip', '.exe') } | ForEach-Object { $zips[$_.Name] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
$zips | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.json') -Encoding UTF8
Write-Host 'Build finished. Upload Setup.exe, both ZIP files and SHA256SUMS.json to GitHub Releases.'
