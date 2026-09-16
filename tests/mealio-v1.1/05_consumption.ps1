param(
  [string]$BaseUrl = $(if ($env:MEALIO_BASE_URL) { $env:MEALIO_BASE_URL } else { 'http://localhost:3000' }),
  [string]$Cookie = $env:MEALIO_COOKIE
)

$ErrorActionPreference = 'Stop'

if (-not $Cookie) { throw "MEALIO_COOKIE obligatoire." }

function Api($Method, $Path, $Body = $null) {
  $params = @{
    Method = $Method
    Uri = "$BaseUrl$Path"
    Headers = @{ Cookie = $Cookie }
  }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = ($Body | ConvertTo-Json -Depth 30)
  }
  Invoke-RestMethod @params
}

Write-Host "=== CAMPAGNE 5 — CONSOMMATION ==="

$data = Api GET '/api/meal-consumption'
$pending = @($data.pending)

if ($pending.Count -eq 0) {
  Write-Host "SKIP : aucun repas passé non consommé."
  exit 0
}

for ($i = 0; $i -lt $pending.Count; $i++) {
  Write-Host "[$i] $($pending[$i].plan.scheduled_date) — $($pending[$i].recipe_nom) — $($pending[$i].plan.id)"
}

$choice = Read-Host "Choisir le numéro du repas à CONSOMMER réellement (ENTER=annuler)"
if ([string]::IsNullOrWhiteSpace($choice)) { exit 0 }

$index = [int]$choice
if ($index -lt 0 -or $index -ge $pending.Count) { throw "Choix invalide." }

$planId = [string]$pending[$index].plan.id

Write-Host ""
Write-Host "ATTENTION : ce test va réellement décrémenter Frosti/Cellio."
$confirm = Read-Host "Taper exactement OUI pour continuer"
if ($confirm -cne 'OUI') {
  Write-Host "Annulé."
  exit 0
}

$first = Api POST '/api/meal-consumption' @{
  meal_plan_id = $planId
  confirmed = $true
}

Write-Host "1er appel : status=$($first.result.status)"
Write-Host "Consommés : $(@($first.result.consumed).Count)"
Write-Host "Ruptures : $(@($first.result.shortages).Count)"

$second = Api POST '/api/meal-consumption' @{
  meal_plan_id = $planId
  confirmed = $true
}

$secondConsumed = @($second.result.consumed).Count
$secondShortages = @($second.result.shortages).Count

Write-Host "2e appel : status=$($second.result.status)"
Write-Host "2e appel consommés : $secondConsumed"
Write-Host "2e appel ruptures : $secondShortages"

if ($first.result.status -ne 'confirmed') {
  Write-Host "FAIL : le premier appel n'est pas confirmed"
  exit 1
}

if ($secondConsumed -ne 0) {
  Write-Host "FAIL : le deuxième appel a consommé à nouveau du stock"
  exit 1
}

Write-Host "PASS : le deuxième appel est idempotent."

# Vérification finale : le repas ne doit plus être pending.
$after = Api GET '/api/meal-consumption'
$stillPending = @($after.pending | Where-Object { $_.plan.id -eq $planId })

if ($stillPending.Count -eq 0) {
  Write-Host "PASS : le repas n'est plus dans pending."
} else {
  Write-Host "FAIL : le repas est toujours pending."
  exit 1
}
