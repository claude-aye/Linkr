# ============================================================================
#  Linkr - Phase 3.9 (Quotes) smoke test
#  Self-contained. Windows PowerShell 5.1. Requires curl.exe + the API on :3000
#  (feature branch claude/stoic-galileo-ZKwXp checked out, migration:run done).
#
#  Run:  .\linkr-smoke-3.9-quotes.ps1
#
#  Actors:  alice (ADMIN, client) | bob (provider 1) | carol (provider 2, provisioned)
# ============================================================================

$base = "http://localhost:3000"
$script:Pass = 0
$script:Fail = 0

# --- Known catalog / fixture IDs (from handoff) -----------------------------
$coiffureId  = "0c44ccbd-fceb-4129-b81f-3e40c02ccdd3"   # INFORMAL -> NOT_REQUIRED
$itemId      = "b46a49b3-4625-45a4-b397-14fa294e12e6"   # coupe-homme (under coiffure)
$plomberieId = "8e8f4c31-1756-4763-ac88-0d7866e35777"   # REGULATED (bob is PENDING here)
$bobProvId   = "81127c85-c332-4388-a37c-a0aed100959e"

# Quebec City coordinates [lng, lat]
$lng = -71.2080
$lat = 46.8139

# --- Date helpers (ISO 8601 UTC) --------------------------------------------
$futureUtc = ([DateTime]::UtcNow.AddDays(7)).ToString("o")
$pastUtc   = ([DateTime]::UtcNow.AddDays(-1)).ToString("o")

# ============================================================================
#  Base helpers (verbatim from handoff)
# ============================================================================
function Invoke-Api {
  param([string]$Method, [string]$Url, [string]$Token, [string]$JsonBody)
  $curlArgs = @($Url, "-s", "-X", $Method, "-w", "HTTP_STATUS:%{http_code}")
  if ($Token) { $curlArgs += @("-H", "Authorization: Bearer $Token") }
  $tmp = $null
  if ($JsonBody) {
    $tmp = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($tmp, $JsonBody)
    $curlArgs += @("-H", "Content-Type: application/json", "--data-binary", "@$tmp")
  }
  try { $out = & curl.exe @curlArgs } finally { if ($tmp) { Remove-Item $tmp -ErrorAction SilentlyContinue } }
  return ($out -join "`n")
}

function Api-Json {
  param([string]$Method, [string]$Url, [string]$Token, [string]$JsonBody)
  $text = Invoke-Api -Method $Method -Url $Url -Token $Token -JsonBody $JsonBody
  $status = $null; $bodyText = $text
  if ($text -match "HTTP_STATUS:(\d+)\s*$") { $status = [int]$Matches[1]; $bodyText = ($text -replace "HTTP_STATUS:\d+\s*$", "") }
  $body = $null
  if ($bodyText.Trim()) { try { $body = $bodyText | ConvertFrom-Json } catch { $body = $bodyText } }
  return [PSCustomObject]@{ status=$status; body=$body; raw=$text }
}

# ============================================================================
#  Assertion helpers
# ============================================================================
function Assert-Status {
  param($Resp, [int]$Expected, [string]$Label)
  if ($Resp.status -eq $Expected) {
    Write-Host "  PASS  [$($Resp.status)] $Label" -ForegroundColor Green
    $script:Pass++
  } else {
    Write-Host "  FAIL  expected $Expected, got $($Resp.status) :: $Label" -ForegroundColor Red
    if ($Resp.body) { Write-Host "        body: $($Resp.body | ConvertTo-Json -Depth 4 -Compress)" -ForegroundColor DarkYellow }
    $script:Fail++
  }
}
function Assert-True {
  param([bool]$Cond, [string]$Label, [string]$Got = $null)
  if ($Cond) { Write-Host "  PASS  $Label" -ForegroundColor Green; $script:Pass++ }
  else {
    $extra = ""
    if ($Got) { $extra = " (got: $Got)" }
    Write-Host "  FAIL  $Label$extra" -ForegroundColor Red
    $script:Fail++
  }
}

# --- Defensive list extraction (quote list envelope is unconfirmed) ---------
function QuoteList { param($body)
  if ($null -eq $body) { return @() }
  if ($body -is [array]) { return $body }
  if ($body.data)   { return @($body.data) }
  if ($body.items)  { return @($body.items) }
  if ($body.quotes) { return @($body.quotes) }
  return @($body)
}
function FindQuote { param($body, [string]$Id) (QuoteList $body) | Where-Object { $_.id -eq $Id } | Select-Object -First 1 }

# ============================================================================
#  Domain helpers
# ============================================================================
function Login { param([string]$Email, [string]$Password)
  $r = Invoke-WebRequest -Uri "$base/auth/login" -Method POST -ContentType "application/json" -UseBasicParsing -Body (@{email=$Email;password=$Password}|ConvertTo-Json)
  return ($r.Content | ConvertFrom-Json).accessToken
}
function Signup { param([string]$Email, [string]$Password, [string]$First, [string]$Last)
  $json = @"
{ "email": "$Email", "password": "$Password", "firstName": "$First", "lastName": "$Last", "countryCode": "CA", "subdivisionCode": "CA-QC", "preferredCurrency": "CAD" }
"@
  Api-Json -Method POST -Url "$base/auth/signup" -Token $null -JsonBody $json
}
function New-Provider { param([string]$Token, [double]$Lng, [double]$Lat, [int]$RadiusKm, [string]$BusinessName)
  $json = @"
{
  "providerType": "INDIVIDUAL",
  "businessName": "$BusinessName",
  "serviceBaseLocation": { "type": "Point", "coordinates": [$Lng, $Lat] },
  "serviceRadiusKm": $RadiusKm
}
"@
  Api-Json -Method POST -Url "$base/service-providers" -Token $Token -JsonBody $json
}
function Add-ProviderCategory { param([string]$Token, [string]$ProviderId, [string]$CategoryId)
  $json = @"
{ "serviceCategoryId": "$CategoryId" }
"@
  Api-Json -Method POST -Url "$base/service-providers/$ProviderId/categories" -Token $Token -JsonBody $json
}
function New-Tender { param([string]$Token, [string]$CategoryId, [string]$Title, [double]$Lng, [double]$Lat, [string]$QuotesDeadlineUtc)
  $json = @"
{
  "requestType": "PROJECT_TENDER",
  "serviceCategoryId": "$CategoryId",
  "title": "$Title",
  "description": "Smoke test tender",
  "serviceAddress": "123 Test St, Quebec City",
  "serviceLocation": { "type": "Point", "coordinates": [$Lng, $Lat] },
  "quotesDeadlineUtc": "$QuotesDeadlineUtc"
}
"@
  Api-Json -Method POST -Url "$base/service-requests" -Token $Token -JsonBody $json
}
function New-DirectBooking { param([string]$Token, [string]$CategoryId, [string]$ItemId, [string]$ProviderId, [string]$Title, [double]$Lng, [double]$Lat, [string]$ResponseDeadlineUtc)
  $json = @"
{
  "requestType": "DIRECT_BOOKING",
  "serviceCategoryId": "$CategoryId",
  "serviceItemId": "$ItemId",
  "requestedServiceProviderId": "$ProviderId",
  "title": "$Title",
  "description": "Smoke test direct booking",
  "serviceAddress": "123 Test St, Quebec City",
  "serviceLocation": { "type": "Point", "coordinates": [$Lng, $Lat] },
  "responseDeadlineUtc": "$ResponseDeadlineUtc"
}
"@
  Api-Json -Method POST -Url "$base/service-requests" -Token $Token -JsonBody $json
}
function Get-Request    { param([string]$Token, [string]$Id) Api-Json -Method GET  -Url "$base/service-requests/$Id" -Token $Token }
function Accept-Request { param([string]$Token, [string]$Id) Api-Json -Method POST -Url "$base/service-requests/$Id/accept" -Token $Token }

# --- Quote helpers (confirmed routes/DTO) -----------------------------------
function Submit-Quote {
  param([string]$Token, [string]$RequestId, [double]$Amount, [string]$Currency = "CAD",
        [int]$DurationMin, [string]$Description, [string]$ValidUntilUtc, [string]$ProposedStartAtUtc = $null)
  $obj = @{ amount=$Amount; currency=$Currency; estimatedDurationMinutes=$DurationMin; description=$Description; validUntilUtc=$ValidUntilUtc }
  if ($ProposedStartAtUtc) { $obj.proposedStartAtUtc = $ProposedStartAtUtc }
  Api-Json -Method POST -Url "$base/service-requests/$RequestId/quotes" -Token $Token -JsonBody ($obj | ConvertTo-Json)
}
function Accept-Quote   { param([string]$Token, [string]$QuoteId)   Api-Json -Method POST -Url "$base/quotes/$QuoteId/accept"   -Token $Token }
function Withdraw-Quote { param([string]$Token, [string]$QuoteId)   Api-Json -Method POST -Url "$base/quotes/$QuoteId/withdraw" -Token $Token }
function Get-ReqQuotes  { param([string]$Token, [string]$RequestId) Api-Json -Method GET  -Url "$base/service-requests/$RequestId/quotes" -Token $Token }
function Get-MyQuotes   { param([string]$Token)                     Api-Json -Method GET  -Url "$base/quotes/mine" -Token $Token }
function Run-QuoteExpiry{ param([string]$Token)                     Api-Json -Method POST -Url "$base/admin/quotes/run-expiry-check" -Token $Token }

# ============================================================================
#  STAGE 0 - Logins (tokens valid 15 min)
# ============================================================================
Write-Host "`n=== STAGE 0: logins ===" -ForegroundColor Cyan
$aliceTok = Login -Email "alice@linkr.test" -Password "Password123!"
$bobTok   = Login -Email "bob@linkr.test"   -Password "Password123!"
Assert-True ([bool]$aliceTok) "alice login"
Assert-True ([bool]$bobTok)   "bob login"

# ============================================================================
#  STAGE A - Core quote lifecycle (alice client, bob single provider)
# ============================================================================
Write-Host "`n=== STAGE A: core quote lifecycle (alice + bob) ===" -ForegroundColor Cyan

# A1 - tender T1 (coiffure, OPEN)
$t1 = New-Tender -Token $aliceTok -CategoryId $coiffureId -Title "Coupe homme T1" -Lng $lng -Lat $lat -QuotesDeadlineUtc $futureUtc
Assert-Status $t1 201 "alice creates PROJECT_TENDER T1"
$t1Id = $t1.body.id

# A2 - submit with no provider (alice has none) -> 403
$r = Submit-Quote -Token $aliceTok -RequestId $t1Id -Amount 200 -DurationMin 60 -Description "no-provider" -ValidUntilUtc $futureUtc
Assert-Status $r 403 "submit without a provider -> 403"

# A3 - validUntil in the past -> 400 (DTO validation, runs before duplicate check)
$r = Submit-Quote -Token $bobTok -RequestId $t1Id -Amount 200 -DurationMin 60 -Description "past validity" -ValidUntilUtc $pastUtc
Assert-Status $r 400 "submit with past validUntilUtc -> 400"

# A4 - ineligible category: bob on a plomberie tender (bob's plomberie is PENDING) -> 403
$tPlomb = New-Tender -Token $aliceTok -CategoryId $plomberieId -Title "Plomberie T" -Lng $lng -Lat $lat -QuotesDeadlineUtc $futureUtc
Assert-Status $tPlomb 201 "alice creates plomberie tender"
$r = Submit-Quote -Token $bobTok -RequestId $tPlomb.body.id -Amount 300 -DurationMin 90 -Description "ineligible" -ValidUntilUtc $futureUtc
Assert-Status $r 403 "submit on category not VERIFIED/NOT_REQUIRED -> 403"

# A5 - happy submit -> 201
$q1 = Submit-Quote -Token $bobTok -RequestId $t1Id -Amount 250 -DurationMin 60 -Description "Bob first quote" -ValidUntilUtc $futureUtc
Assert-Status $q1 201 "bob submits quote Q1 -> 201"
$q1Id = $q1.body.id

# A6 - duplicate live quote -> 409 (partial-unique)
$r = Submit-Quote -Token $bobTok -RequestId $t1Id -Amount 260 -DurationMin 60 -Description "dup" -ValidUntilUtc $futureUtc
Assert-Status $r 409 "duplicate live quote -> 409"

# A7 - listing visibility
$lo = Get-ReqQuotes -Token $aliceTok -RequestId $t1Id
$lp = Get-ReqQuotes -Token $bobTok   -RequestId $t1Id
Assert-True ([bool](FindQuote $lo.body $q1Id)) "owner (alice) sees Q1 on T1"
if (-not (FindQuote $lo.body $q1Id)) { Write-Host "        owner list raw: $($lo.body | ConvertTo-Json -Depth 5 -Compress)" -ForegroundColor DarkYellow }
Assert-True ([bool](FindQuote $lp.body $q1Id))  "provider (bob) sees own quote on T1"
$mine = Get-MyQuotes -Token $bobTok
Assert-True ([bool](FindQuote $mine.body $q1Id)) "GET /quotes/mine returns bob quote"

# A8 - withdraw + resubmit (slot freed)
$r = Withdraw-Quote -Token $bobTok -QuoteId $q1Id
Assert-Status $r 200 "bob withdraws Q1 -> 200"
$q2 = Submit-Quote -Token $bobTok -RequestId $t1Id -Amount 240 -DurationMin 55 -Description "Bob resubmitted quote" -ValidUntilUtc $futureUtc
Assert-Status $q2 201 "bob resubmits after withdraw (slot freed) -> 201"
$q2Id = $q2.body.id

# A9 - withdraw ownership guard: alice (not the provider) withdraws Q2 -> 403
$r = Withdraw-Quote -Token $aliceTok -QuoteId $q2Id
Assert-Status $r 403 "non-owner withdraw -> 403"

# A10 - invalid transition: withdraw the already-WITHDRAWN Q1 -> 409
$r = Withdraw-Quote -Token $bobTok -QuoteId $q1Id
Assert-Status $r 409 "withdraw an already-withdrawn quote -> 409 (invalid transition)"

# A11 - accept guard: non-owner (bob) tries to accept on alice's tender -> 403
$r = Accept-Quote -Token $bobTok -QuoteId $q2Id
Assert-Status $r 403 "non-client accept -> 403"

# A12 - accept (client) -> request ASSIGNED + assignedServiceProviderId
$r = Accept-Quote -Token $aliceTok -QuoteId $q2Id
Assert-Status $r 200 "alice accepts Q2 -> 200"
$t1After = Get-Request -Token $aliceTok -Id $t1Id
Assert-True ($t1After.body.status -eq "ASSIGNED") "T1 transitioned to ASSIGNED" $t1After.body.status
Assert-True ($t1After.body.assignedServiceProviderId -eq $bobProvId) "assignedServiceProviderId = bob provider" $t1After.body.assignedServiceProviderId
$qAfter = FindQuote (Get-ReqQuotes -Token $aliceTok -RequestId $t1Id).body $q2Id
Assert-True ($qAfter.status -eq "ACCEPTED") "Q2 is ACCEPTED" $qAfter.status

# A13 - re-accept -> 409 (quote not SUBMITTED / request not OPEN)
$r = Accept-Quote -Token $aliceTok -QuoteId $q2Id
Assert-Status $r 409 "re-accept an accepted quote -> 409"

# ============================================================================
#  STAGE C - Quote-level expiry sweep (uses short validity, no SQL needed)
# ============================================================================
Write-Host "`n=== STAGE C: quote expiry sweep ===" -ForegroundColor Cyan
$t2 = New-Tender -Token $aliceTok -CategoryId $coiffureId -Title "Expiry tender T2" -Lng $lng -Lat $lat -QuotesDeadlineUtc $futureUtc
Assert-Status $t2 201 "alice creates tender T2 (expiry)"
$t2Id = $t2.body.id
$soonUtc = ([DateTime]::UtcNow.AddSeconds(5)).ToString("o")
$qe = Submit-Quote -Token $bobTok -RequestId $t2Id -Amount 199 -DurationMin 30 -Description "short-lived" -ValidUntilUtc $soonUtc
Assert-Status $qe 201 "bob submits short-lived quote -> 201"
$qeId = $qe.body.id

# non-admin cannot trigger the sweep
$r = Run-QuoteExpiry -Token $bobTok
Assert-Status $r 403 "non-admin run-expiry-check -> 403"

Write-Host "  ... waiting 8s for the quote to expire ..." -ForegroundColor DarkGray
Start-Sleep -Seconds 8
$sweep = Run-QuoteExpiry -Token $aliceTok
Assert-Status $sweep 200 "admin run-expiry-check -> 200"
$qeAfter = FindQuote (Get-ReqQuotes -Token $aliceTok -RequestId $t2Id).body $qeId
Assert-True ($qeAfter.status -eq "EXPIRED") "expired quote swept to EXPIRED" $qeAfter.status

# ============================================================================
#  STAGE D - 3.8c-1 regression: DIRECT_BOOKING accept still works
# ============================================================================
Write-Host "`n=== STAGE D: DIRECT_BOOKING regression (shared assign path) ===" -ForegroundColor Cyan
$t3 = New-DirectBooking -Token $aliceTok -CategoryId $coiffureId -ItemId $itemId -ProviderId $bobProvId -Title "Direct booking T3" -Lng $lng -Lat $lat -ResponseDeadlineUtc $futureUtc
Assert-Status $t3 201 "alice creates DIRECT_BOOKING targeting bob"
$t3Id = $t3.body.id
$r = Accept-Request -Token $bobTok -Id $t3Id
Assert-Status $r 200 "bob (provider) accepts direct booking -> 200"
$t3After = Get-Request -Token $aliceTok -Id $t3Id
Assert-True ($t3After.body.status -eq "ASSIGNED") "DIRECT_BOOKING transitioned to ASSIGNED" $t3After.body.status
Assert-True ($t3After.body.assignedServiceProviderId -eq $bobProvId) "DIRECT_BOOKING assigned to bob provider" $t3After.body.assignedServiceProviderId

# ============================================================================
#  STAGE B - Sibling auto-reject (needs a 2nd provider: carol)
#  NOTE: SignupDto came back empty in OpenAPI; carol's signup body is a best
#  guess (email/password/firstName/lastName). If signup or provider creation
#  fails, STAGE B is skipped and the body is printed so we can adjust.
# ============================================================================
Write-Host "`n=== STAGE B: sibling auto-reject (carol provisioning) ===" -ForegroundColor Cyan
$stageBok = $true
$carolEmail = "carol+$([Guid]::NewGuid().ToString('N').Substring(0,8))@linkr.test"

$signup = Signup -Email $carolEmail -Password "Password123!" -First "Carol" -Last "Test"
if ($signup.status -ne 201 -and $signup.status -ne 200) {
  Write-Host "  SKIP  carol signup failed ($($signup.status)) - SignupDto field mismatch likely." -ForegroundColor Yellow
  Write-Host "        body: $($signup.body | ConvertTo-Json -Depth 4 -Compress)" -ForegroundColor DarkYellow
  $stageBok = $false
}

if ($stageBok) {
  $carolTok = Login -Email $carolEmail -Password "Password123!"
  $prov = New-Provider -Token $carolTok -Lng $lng -Lat $lat -RadiusKm 25 -BusinessName "Carol Coiffure"
  if ($prov.status -ne 201 -and $prov.status -ne 200) {
    Write-Host "  SKIP  carol provider creation failed ($($prov.status))." -ForegroundColor Yellow
    Write-Host "        body: $($prov.body | ConvertTo-Json -Depth 4 -Compress)" -ForegroundColor DarkYellow
    Write-Host "        If it is a PHONE/verification gate, bump carol in pgAdmin then re-run STAGE B." -ForegroundColor DarkYellow
    $stageBok = $false
  } else {
    $carolProvId = $prov.body.id
    $addCat = Add-ProviderCategory -Token $carolTok -ProviderId $carolProvId -CategoryId $coiffureId
    Assert-True ($addCat.status -eq 201 -or $addCat.status -eq 200) "carol adds coiffure category (-> NOT_REQUIRED)"
  }
}

if ($stageBok) {
  $t4 = New-Tender -Token $aliceTok -CategoryId $coiffureId -Title "Sibling tender T4" -Lng $lng -Lat $lat -QuotesDeadlineUtc $futureUtc
  Assert-Status $t4 201 "alice creates tender T4 (2 providers)"
  $t4Id = $t4.body.id

  $qb = Submit-Quote -Token $bobTok   -RequestId $t4Id -Amount 250 -DurationMin 60 -Description "bob on T4"   -ValidUntilUtc $futureUtc
  $qc = Submit-Quote -Token $carolTok -RequestId $t4Id -Amount 230 -DurationMin 50 -Description "carol on T4" -ValidUntilUtc $futureUtc
  Assert-Status $qb 201 "bob submits on T4"
  Assert-Status $qc 201 "carol submits on T4"
  $qbId = $qb.body.id; $qcId = $qc.body.id

  # owner sees both; each provider sees only their own
  Assert-True ((QuoteList (Get-ReqQuotes -Token $aliceTok -RequestId $t4Id).body).Count -ge 2) "owner sees both quotes on T4"
  Assert-True (-not (FindQuote (Get-ReqQuotes -Token $bobTok -RequestId $t4Id).body $qcId)) "bob does NOT see carol quote"
  Assert-True (-not (FindQuote (Get-ReqQuotes -Token $carolTok -RequestId $t4Id).body $qbId)) "carol does NOT see bob quote"

  # accept bob's quote -> carol's auto-REJECTED, request ASSIGNED to bob
  $r = Accept-Quote -Token $aliceTok -QuoteId $qbId
  Assert-Status $r 200 "alice accepts bob quote on T4"
  $listT4 = (Get-ReqQuotes -Token $aliceTok -RequestId $t4Id).body
  Assert-True ((FindQuote $listT4 $qbId).status -eq "ACCEPTED") "bob quote ACCEPTED" (FindQuote $listT4 $qbId).status
  Assert-True ((FindQuote $listT4 $qcId).status -eq "REJECTED") "carol sibling quote auto-REJECTED" (FindQuote $listT4 $qcId).status
  $t4After = Get-Request -Token $aliceTok -Id $t4Id
  Assert-True ($t4After.body.status -eq "ASSIGNED") "T4 transitioned to ASSIGNED" $t4After.body.status
  Assert-True ($t4After.body.assignedServiceProviderId -eq $bobProvId) "T4 assigned to bob provider" $t4After.body.assignedServiceProviderId
}

# ============================================================================
#  Summary
# ============================================================================
Write-Host "`n==================== SMOKE SUMMARY ====================" -ForegroundColor Cyan
$summaryColor = "Green"; if ($script:Fail -gt 0) { $summaryColor = "Red" }
Write-Host ("  PASS: {0}    FAIL: {1}" -f $script:Pass, $script:Fail) -ForegroundColor $summaryColor
Write-Host "=======================================================`n"
