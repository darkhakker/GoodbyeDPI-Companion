$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
foreach ($folder in @('installer', 'scripts')) {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root $folder) -Filter '*.ps1') {
        $tokens = $null; $errors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
        if ($errors.Count) { throw ($errors | Out-String) }
        $assignments = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] }, $true)
        foreach ($assignment in $assignments) {
            if ($assignment.Left -is [Management.Automation.Language.VariableExpressionAst]) {
                $name = $assignment.Left.VariablePath.UserPath
                if ($name -match '^(HOME|CODEX_HOME|PSHOME|PID|PSScriptRoot|PSCommandPath|Host|ExecutionContext|Error|Args)$') {
                    throw ('Protected variable assignment in ' + $file.Name + ': ' + $name)
                }
            }
        }
    }
}
Write-Host 'Installer PowerShell syntax and protected-variable contract passed'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'installer\Install.ps1'), [ref]$tokens, [ref]$errors)
$copyFunction = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Copy-ComponentFile' }, $true)
if (!$copyFunction) { throw 'Missing verified component copy function' }
. ([scriptblock]::Create($copyFunction.Extent.Text))
$folder = Join-Path ([IO.Path]::GetTempPath()) ('GoodbyeDPI-copy-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder | Out-Null
$sourceFile = Join-Path $folder 'source.bin'
$targetFile = Join-Path $folder 'target.bin'
try {
    [IO.File]::WriteAllBytes($sourceFile, [byte[]]@(1,2,3))
    [IO.File]::WriteAllBytes($targetFile, [byte[]]@(1,2,3))
    $locked = New-Object IO.FileStream($targetFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try { Copy-ComponentFile $sourceFile $targetFile } finally { $locked.Dispose() }
    [IO.File]::WriteAllBytes($sourceFile, [byte[]]@(4,5,6))
    Copy-ComponentFile $sourceFile $targetFile
    if ((Get-FileHash -LiteralPath $sourceFile).Hash -ne (Get-FileHash -LiteralPath $targetFile).Hash) { throw 'Changed component not updated' }
} finally {
    Remove-Item -LiteralPath $sourceFile, $targetFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $folder -Force -ErrorAction SilentlyContinue
}
Write-Host 'Loaded-driver update regression passed: identical locked files are not rewritten'
