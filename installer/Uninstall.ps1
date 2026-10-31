[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
try {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $command = "& '" + $PSCommandPath.Replace("'", "''") + "'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $child = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        exit $child.ExitCode
    }
    $service = Get-Service -Name GoodbyeDPICompanion -ErrorAction SilentlyContinue
    if ($service) {
        Stop-Service -Name GoodbyeDPICompanion -ErrorAction Stop
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
        & sc.exe delete GoodbyeDPICompanion
        if ($LASTEXITCODE -ne 0) { throw 'Service deletion failed' }
    }
    foreach ($browser in @('Google\Chrome', 'Microsoft\Edge', 'Chromium')) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
            if ($view -eq [Microsoft.Win32.RegistryView]::Registry64 -and ![Environment]::Is64BitOperatingSystem) { continue }
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
            try { $base.DeleteSubKeyTree("SOFTWARE\$browser\NativeMessagingHosts\org.goodbyedpi.companion", $false) } finally { $base.Dispose() }
        }
    }
    # Deliberately retain logs and files; never delete a shared WinDivert service.
    Write-Host 'Service and browser registration removed. You may now delete the GoodbyeDPICompanion folders in Program Files and ProgramData.'
} catch { Write-Error $_ -ErrorAction Continue; exit 1 }
