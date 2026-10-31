$ErrorActionPreference = 'Stop'
$bundle = Join-Path (Split-Path $PSScriptRoot -Parent) 'release\GoodbyeDPI-Companion-Windows'
& (Join-Path $bundle 'Companion.exe') --self-test
if ($LASTEXITCODE -ne 0) { throw 'Native self-test failed' }
# Launch only the nonprivileged host with an invalid origin; no service or driver is installed.
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = Join-Path $bundle 'Companion.exe'
$start.Arguments = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$process = [Diagnostics.Process]::Start($start)
$memory = New-Object IO.MemoryStream
$process.StandardOutput.BaseStream.CopyTo($memory)
$process.WaitForExit()
$bytes = $memory.ToArray()
if ($bytes.Length -lt 5) { throw 'No native message frame' }
$size = [BitConverter]::ToInt32($bytes, 0)
if ($size -ne ($bytes.Length - 4)) { throw 'Invalid frame length' }
$reply = [Text.Encoding]::UTF8.GetString($bytes, 4, $size) | ConvertFrom-Json
if ($reply.ok -or $reply.error -ne 'Unexpected extension origin') { throw 'Origin guard failed' }
$process.Dispose()
Write-Host 'Native origin rejection and binary framing passed'

# Exercise real native-host stdio -> local pipe -> stdio, using a nonprivileged mock.
$installedService = Get-Service -Name GoodbyeDPICompanion -ErrorAction SilentlyContinue
if ($installedService -and $installedService.Status -eq 'Running') {
    Write-Host 'Real companion service is running; mock pipe test skipped to avoid interfering with it. CI runs this test on a clean runner.'
    exit 0
}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$pipe = New-Object IO.Pipes.NamedPipeServerStream("GoodbyeDPICompanion-$sid", [IO.Pipes.PipeDirection]::InOut, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous)
$process = $null
$originalInputEncoding = [Console]::InputEncoding
try {
    $waiting = $pipe.BeginWaitForConnection($null, $null)
    $id = (Get-Content -LiteralPath (Join-Path $bundle 'extension-id.txt') -Raw).Trim()
    $start.Arguments = "chrome-extension://$id/"
    $start.RedirectStandardInput = $true
    # Hosted runners may use UTF-8 with a BOM for Console.InputEncoding.
    # StreamWriter.AutoFlush would prepend it before the binary frame otherwise.
    [Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
    $process = [Diagnostics.Process]::Start($start)
    $request = [Text.Encoding]::UTF8.GetBytes('{"command":"configure","domains":["tiktok.com"],"profile":"balanced","enabled":false}')
    $frame = [BitConverter]::GetBytes([int]$request.Length) + $request
    $process.StandardInput.BaseStream.Write($frame, 0, $frame.Length)
    $process.StandardInput.BaseStream.Flush()
    if (!$waiting.AsyncWaitHandle.WaitOne(5000)) {
        if ($process.HasExited) {
            $diagnostic = New-Object IO.MemoryStream
            $process.StandardOutput.BaseStream.CopyTo($diagnostic)
            $raw = $diagnostic.ToArray()
            if ($raw.Length -ge 4) { throw ('Native host error: ' + [Text.Encoding]::UTF8.GetString($raw, 4, $raw.Length - 4)) }
        }
        throw 'Mock pipe connection timed out'
    }
    $pipe.EndWaitForConnection($waiting)
    function Read-Bytes([IO.Stream]$Stream, [int]$Count) {
        $buffer = New-Object byte[] $Count
        $position = 0
        while ($position -lt $Count) {
            $pending = $Stream.BeginRead($buffer, $position, $Count - $position, $null, $null)
            if (!$pending.AsyncWaitHandle.WaitOne(5000)) { throw 'Mock read timeout' }
            $read = $Stream.EndRead($pending)
            $pending.AsyncWaitHandle.Close()
            if ($read -eq 0) { throw 'Unexpected end of frame' }
            $position += $read
        }
        return ,$buffer
    }
    $count = [BitConverter]::ToInt32((Read-Bytes $pipe 4), 0)
    if ($count -lt 1 -or $count -gt 262144) { throw 'Invalid forwarded length' }
    $received = [Text.Encoding]::UTF8.GetString((Read-Bytes $pipe $count)) | ConvertFrom-Json
    if ($received.command -ne 'configure' -or $received.domains[0] -ne 'tiktok.com') { throw 'Forwarded request mismatch' }
    $response = [Text.Encoding]::UTF8.GetBytes('{"ok":true,"running":false,"domainCount":1}')
    $frame = [BitConverter]::GetBytes([int]$response.Length) + $response
    $pipe.Write($frame, 0, $frame.Length); $pipe.Flush()
    if (!$process.WaitForExit(5000)) { throw 'Native host did not exit' }
    $memory = New-Object IO.MemoryStream
    $process.StandardOutput.BaseStream.CopyTo($memory)
    $bytes = $memory.ToArray()
    $count = [BitConverter]::ToInt32($bytes, 0)
    $reply = [Text.Encoding]::UTF8.GetString($bytes, 4, $count) | ConvertFrom-Json
    if (!$reply.ok -or $reply.domainCount -ne 1) { throw 'Native reply mismatch' }
    Write-Host 'Native-host stdio / named-pipe round trip passed (no service installed)'
} finally {
    $pipe.Dispose()
    if ($process) { try { if (!$process.HasExited) { $process.Kill() } } catch { } }
    if ($process) { $process.Dispose() }
    [Console]::InputEncoding = $originalInputEncoding
}
