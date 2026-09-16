param(
  [switch]$IntegrationCourses,
  [switch]$IntegrationConsumption
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Resolve-Path "$root\..\.."

Push-Location $project
try {
  Write-Host "=== 2 : AGRÉGATION / UNITÉS ==="
  npx vitest run tests/mealio-v1.1/02_aggregation_unit_safety.test.ts
  if ($LASTEXITCODE) { exit $LASTEXITCODE }

  Write-Host "`n=== 3 : STOCK MULTI-LIGNES ==="
  npx vitest run tests/mealio-v1.1/03_stock_multiline.test.ts
  if ($LASTEXITCODE) { exit $LASTEXITCODE }

  if ($env:MEALIO_COOKIE) {
    Write-Host "`n=== 1 : MATCHER LAB ==="
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\01_matcher_lab.ps1"
    if ($LASTEXITCODE) { exit $LASTEXITCODE }

    Write-Host "`n=== 6 : RÉAPPROVISIONNEMENT ==="
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\06_replenishment.ps1"
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
  } else {
    Write-Host "`nCampagnes HTTP 1 et 6 ignorées : MEALIO_COOKIE absent."
  }

  if ($IntegrationCourses) {
    if (-not $env:MEALIO_COOKIE) { throw "MEALIO_COOKIE obligatoire pour Courses." }
    Write-Host "`n=== 4 : COURSES ==="
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\04_courses_regeneration.ps1" -Execute
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
  }

  if ($IntegrationConsumption) {
    if (-not $env:MEALIO_COOKIE) { throw "MEALIO_COOKIE obligatoire pour Consommation." }
    Write-Host "`n=== 5 : CONSOMMATION ==="
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$root\05_consumption.ps1"
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
  }

  Write-Host "`nTOUTES LES CAMPAGNES DEMANDÉES SONT TERMINÉES."
}
finally {
  Pop-Location
}
