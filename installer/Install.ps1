[CmdletBinding()]
param([string]$OwnerSid, [string]$LogPath)
$ErrorActionPreference = 'Stop'
if (!$LogPath) { $LogPath = Join-Path $PSScriptRoot 'install.log' }
function Write-InstallLog([string]$Message) {
    try { [IO.File]::AppendAllText($LogPath, ([DateTime]::UtcNow.ToString('o') + ' ' + $Message + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false))) } catch { }
}
function Set-InstallStage([string]$Name) { $script:InstallStage = $Name; Write-InstallLog $Name }
Set-InstallStage 'Initializing installer'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (!$OwnerSid) { $OwnerSid = $identity.User.Value }
    if ($OwnerSid -notmatch '^S-1-5-21-(\d+-){2}\d+-\d+$') { throw 'A local Windows user account is required' }
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Set-InstallStage 'Requesting Windows administrator permission'
        $escaped = $PSCommandPath.Replace("'", "''")
        $escapedLog = $LogPath.Replace("'", "''")
        $command = "& '$escaped' -OwnerSid '$OwnerSid' -LogPath '$escapedLog'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        Write-Host 'Windows will ask for administrator permission to install the companion and its driver.'
        $child = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        Write-InstallLog ('Elevated installer exit code: ' + $child.ExitCode)
        if ($child.ExitCode -ne 0) { throw ('Elevated installation failed. See ' + $LogPath) }
        Write-Host 'Installed. Open the extension and press Refresh.'
        exit 0
    }
    Set-InstallStage 'Verifying installation files'
    $id = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'extension-id.txt') -Raw).Trim()
    if ($id -notmatch '^[a-p]{32}$') { throw 'Invalid extension ID' }
    $hashes = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'checksums.json') -Raw | ConvertFrom-Json
    foreach ($property in $hashes.PSObject.Properties) {
        $file = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $property.Name))
        if (!$file.StartsWith($PSScriptRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid bundle path' }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $property.Value) { throw "File checksum mismatch: $($property.Name)" }
    }
    $companionInstallRoot = Join-Path $env:ProgramFiles 'GoodbyeDPICompanion'
    $data = Join-Path $env:ProgramData 'GoodbyeDPICompanion'
    $existing = Get-Service -Name GoodbyeDPICompanion -ErrorAction SilentlyContinue
    if ($existing) { Stop-Service -Name GoodbyeDPICompanion -ErrorAction Stop; $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20)) }
    if ((Test-Path -LiteralPath (Join-Path $companionInstallRoot 'owner.sid')) -and ((Get-Content -LiteralPath (Join-Path $companionInstallRoot 'owner.sid') -Raw).Trim() -ne $OwnerSid)) { throw 'Already installed for a different Windows account. Uninstall before changing the owner.' }
    Set-InstallStage 'Creating protected installation directories'
    New-Item -ItemType Directory -Path $companionInstallRoot, $data -Force | Out-Null
    # Protect privileged executables and service-written state from user replacement.
    foreach ($folder in @($companionInstallRoot, $data)) {
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true, $false)
        $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
        foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', $inherit, 'None', 'Allow')))
        }
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($OwnerSid)), 'ReadAndExecute', $inherit, 'None', 'Allow')))
        Set-Acl -LiteralPath $folder -AclObject $acl
    }
    Set-InstallStage 'Copying program and driver files'
    foreach ($name in @('Companion.exe', 'public_suffix_list.dat', 'extension-id.txt', 'Uninstall.ps1', 'Uninstall.cmd', 'README.md', 'THIRD-PARTY.md', 'LICENSE', 'VALIDATION.md')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $companionInstallRoot -Force
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'engine') -Destination $companionInstallRoot -Recurse -Force
    Set-Content -LiteralPath (Join-Path $companionInstallRoot 'owner.sid') -Value $OwnerSid -Encoding ASCII
    $hostManifest = @{
        name = 'org.goodbyedpi.companion'; description = 'GoodbyeDPI Companion'; type = 'stdio'
        path = (Join-Path $companionInstallRoot 'Companion.exe'); allowed_origins = @("chrome-extension://$id/")
    }
    $manifest = Join-Path $companionInstallRoot 'native-host.json'
    [IO.File]::WriteAllText($manifest, ($hostManifest | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Set-InstallStage 'Registering browser integration'
    foreach ($browser in @('Google\Chrome', 'Microsoft\Edge', 'Chromium')) {
        # Explicit registry views support both 32-bit and 64-bit browsers.
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
            if ($view -eq [Microsoft.Win32.RegistryView]::Registry64 -and ![Environment]::Is64BitOperatingSystem) { continue }
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
            $key = $base.CreateSubKey("SOFTWARE\$browser\NativeMessagingHosts\org.goodbyedpi.companion")
            try { $key.SetValue('', $manifest, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose(); $base.Dispose() }
        }
    }
    $binaryPath = '"' + (Join-Path $companionInstallRoot 'Companion.exe') + '" --service'
    Set-InstallStage 'Registering and starting companion service'
    if (!$existing) { New-Service -Name GoodbyeDPICompanion -DisplayName 'GoodbyeDPI Companion' -BinaryPathName $binaryPath -StartupType Automatic | Out-Null }
    Start-Service -Name GoodbyeDPICompanion
    Set-InstallStage 'Installation completed'
    Write-Host 'Installed. The engine stays off until enabled in the extension.'
} catch {
    Write-InstallLog ('ERROR at stage: ' + $script:InstallStage + [Environment]::NewLine + ($_ | Format-List * -Force | Out-String))
    Write-Error $_ -ErrorAction Continue
    exit 1
}
