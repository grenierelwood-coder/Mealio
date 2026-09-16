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

function ExpectHttpError($Method, $Path, $Body, $ExpectedText) {
  try {
    Api $Method $Path $Body | Out-Null
    return @{ ok = $false; message = 'La requête a été acceptée alors qu''elle devait être refusée.' }
  } catch {
    $message = $_.ErrorDetails.Message
    if (-not $message) { $message = $_.Exception.Message }
    return @{ ok = ($message -match [regex]::Escape($ExpectedText)); message = $message }
  }
}

Write-Host "=== CAMPAGNE 6 — RÉAPPROVISIONNEMENT ==="

$data = Api GET '/api/replenishment'

$pass = 0
$fail = 0

Write-Host "Favoris : $(@($data.favorites).Count)"
Write-Host "Seuils : $(@($data.thresholds).Count)"
Write-Host "Récurrents : $(@($data.recurring).Count)"
Write-Host "Suggestions : $(@($data.suggestions).Count)"

# 1. Vérification structurelle des seuils.
foreach ($t in @($data.thresholds)) {
  if ([double]$t.target_quantity -gt [double]$t.min_quantity -and $t.unite) {
    $pass++
    Write-Host "PASS seuil cohérent : $($t.ingredient_id) / $($t.unite)"
  } else {
    $fail++
    Write-Host "FAIL seuil incohérent : $($t | ConvertTo-Json -Compress)"
  }
}

# 2. Vérification des récurrents.
foreach ($r in @($data.recurring)) {
  if ($r.quantity -gt 0 -and $r.interval_days -gt 0 -and $r.unite) {
    $pass++
    Write-Host "PASS récurrent cohérent : $($r.produit) / $($r.unite)"
  } else {
    $fail++
    Write-Host "FAIL récurrent incohérent : $($r.produit)"
  }
}

# 3. Unité verrouillée sur seuil existant.
$threshold = @($data.thresholds | Where-Object { $_.ingredient_id }) | Select-Object -First 1

if ($threshold) {
  $fakeUnit = if ($threshold.unite -eq 'Gramme') { 'Pièce' } else { 'Gramme' }

  $r = ExpectHttpError PATCH '/api/replenishment/thresholds' @{
    id = $threshold.id
    unite = $fakeUnit
  } "L’unité d’un seuil existant ne peut pas être modifiée"

  if ($r.ok) {
    $pass++
    Write-Host "PASS seuil : changement d'unité refusé"
  } else {
    $fail++
    Write-Host "FAIL seuil : réponse inattendue : $($r.message)"
  }
} else {
  Write-Host "SKIP seuil : aucun seuil existant."
}

# 4. Unité verrouillée sur récurrent existant.
$recurring = @($data.recurring | Where-Object { $_.id }) | Select-Object -First 1

if ($recurring) {
  $fakeUnit = if ($recurring.unite -eq 'Gramme') { 'Pièce' } else { 'Gramme' }

  $r = ExpectHttpError PATCH '/api/replenishment/recurring' @{
    id = $recurring.id
    unite = $fakeUnit
  } "L’unité d’un achat récurrent existant ne peut pas être modifiée"

  if ($r.ok) {
    $pass++
    Write-Host "PASS récurrent : changement d'unité refusé"
  } else {
    $fail++
    Write-Host "FAIL récurrent : réponse inattendue : $($r.message)"
  }
} else {
  Write-Host "SKIP récurrent : aucun récurrent existant."
}

# 5. Suggestions : un même couple source/règle ne doit pas apparaître plusieurs fois.
$duplicateSuggestions = @(
  $data.suggestions |
  Where-Object { $_.rule_id } |
  Group-Object { "$($_.source)::$( $_.rule_id )" } |
  Where-Object Count -gt 1
)

if ($duplicateSuggestions.Count -eq 0) {
  $pass++
  Write-Host "PASS : aucune suggestion récurrente dupliquée par règle"
} else {
  $fail++
  Write-Host "FAIL : $($duplicateSuggestions.Count) doublons de suggestions"
}

Write-Host ""
Write-Host "CAMPAGNE 6 : PASS=$pass FAIL=$fail"

if ($fail) { exit 1 }
