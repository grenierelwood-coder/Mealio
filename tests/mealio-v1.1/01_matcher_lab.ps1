param(
  [string]$BaseUrl = $(if ($env:MEALIO_BASE_URL) { $env:MEALIO_BASE_URL } else { 'http://localhost:3000' }),
  [string]$Cookie = $env:MEALIO_COOKIE
)

$ErrorActionPreference = 'Stop'

if (-not $Cookie) {
  throw "MEALIO_COOKIE est obligatoire. Exemple : `$env:MEALIO_COOKIE='congelo_username=...'`"
}

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

Write-Host "=== CAMPAGNE 1 — MATCHER ==="

$inventory = Api GET '/api/matcher/lab' -Body @{ mode = 'inventory' }
if ($inventory.ok -ne $true) { throw "Inventory Matcher Lab KO" }

Write-Host "Référentiel : $($inventory.diagnostics.officialCount) ingrédients officiels"
Write-Host "Unités : $($inventory.diagnostics.unitCount)"
Write-Host "Densités : $($inventory.diagnostics.densityCount)"
Write-Host "Stock : $($inventory.diagnostics.stockCount) lignes"

$ingredients = (Api GET '/api/ingredients').ingredients |
  Where-Object { $_.unite_reference } |
  Select-Object -First 5

if ($ingredients.Count -eq 0) {
  Write-Host "SKIP : aucun ingrédient officiel avec unite_reference."
  exit 0
}

$pass = 0
$fail = 0

foreach ($ingredient in $ingredients) {
  $body = @{
    mode = 'ingredient'
    name = $ingredient.nom
    qty = 1
    unit = $ingredient.unite_reference
    recipeName = 'TEST V1.1'
  }

  try {
    $r = Api POST '/api/matcher/lab' $body
    $resolved = @($r.resolved)[0]

    $ok = $r.ok -eq $true -and
          $null -ne $resolved -and
          $resolved.ingredient_id -eq $ingredient.id -and
          $resolved.needs_review -eq $false

    if ($ok) {
      $pass++
      Write-Host "PASS $($ingredient.nom) [$($ingredient.unite_reference)]"
    } else {
      $fail++
      Write-Host "FAIL $($ingredient.nom) -> id=$($resolved.ingredient_id) review=$($resolved.needs_review)"
    }
  } catch {
    $fail++
    Write-Host "FAIL $($ingredient.nom) : $($_.Exception.Message)"
  }
}

# Validation d'API : quantités invalides.
try {
  Api POST '/api/matcher/lab' @{
    mode = 'ingredient'; name = $ingredients[0].nom; qty = 0; unit = $ingredients[0].unite_reference
  } | Out-Null
  $fail++
  Write-Host "FAIL validation qty=0 : la route aurait dû refuser"
} catch {
  $pass++
  Write-Host "PASS validation qty=0 refusée"
}

Write-Host ""
Write-Host "CAMPAGNE 1 : PASS=$pass FAIL=$fail"

if ($fail -gt 0) { exit 1 }
