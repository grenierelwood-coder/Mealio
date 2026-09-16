$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
Write-Host ''
Write-Host '========================================'
Write-Host '  MEALIO - MATCHER TEST LAB V33.1'
Write-Host '========================================'
Write-Host ''
npx --yes tsx scripts/run-matcher-lab.ts
$code = $LASTEXITCODE
Write-Host ''
if ($code -eq 0) { Write-Host 'TESTS TERMINES : PASS' } else { Write-Host 'TESTS TERMINES : ECHEC - voir test-reports\' }
Write-Host ''
exit $code
