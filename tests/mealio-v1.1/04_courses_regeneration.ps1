param(
  [string]$BaseUrl = $(if ($env:MEALIO_BASE_URL) { $env:MEALIO_BASE_URL } else { 'http://localhost:3000' }),
  [string]$Cookie = $env:MEALIO_COOKIE,
  [switch]$Execute
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
    $params.Body = ($Body | ConvertTo-Json -Depth 20)
  }
  Invoke-RestMethod @params
}

if (-not $Execute) {
  Write-Host "SKIP : campagne 4 désactivée par défaut car elle modifie la liste active."
  Write-Host "Relancer avec -Execute après validation des campagnes 1-3 et 6."
  exit 0
}

Write-Host "=== CAMPAGNE 4 — COURSES / RÉGÉNÉRATION ==="

$before = Api GET '/api/shopping-list'

$gen1 = Api POST '/api/shopping-list/generate' @{
  includeFuture = $false
  listName = 'TEST V1.1 — régénération'
}

$after1 = Api GET '/api/shopping-list'

$gen2 = Api POST '/api/shopping-list/generate' @{
  includeFuture = $false
  listName = 'TEST V1.1 — régénération'
}

$after2 = Api GET '/api/shopping-list'

$pass = 0
$fail = 0

if ($after1.list -and $after2.list -and $after1.list.id -eq $after2.list.id) {
  $pass++
  Write-Host "PASS même liste active réutilisée : $($after1.list.id)"
} else {
  $fail++
  Write-Host "FAIL la régénération n'a pas réutilisé la même liste"
}

$duplicates = @(
  $after2.items |
  Group-Object {
    if ($_.ingredient_id) {
      "$($_.ingredient_id)::$(($_.unite).ToString().Trim().ToLower())"
    } else {
      "manual::$((($_.produit).ToString()).Trim().ToLower())::$((($_.unite).ToString()).Trim().ToLower())"
    }
  } |
  Where-Object { $_.Count -gt 1 }
)

if ($duplicates.Count -eq 0) {
  $pass++
  Write-Host "PASS aucun doublon ingredient+unité"
} else {
  $fail++
  Write-Host "FAIL $($duplicates.Count) groupe(s) en doublon"
}

Write-Host "Articles avant : $($before.total)"
Write-Host "Articles après génération 1 : $($after1.total)"
Write-Host "Articles après génération 2 : $($after2.total)"
Write-Host "Issues génération 1 : $($gen1.issueCount)"
Write-Host "Issues génération 2 : $($gen2.issueCount)"

Write-Host "CAMPAGNE 4 : PASS=$pass FAIL=$fail"

if ($fail) { exit 1 }
