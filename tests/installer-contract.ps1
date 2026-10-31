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
