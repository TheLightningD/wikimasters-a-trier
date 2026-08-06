param([switch]$Audit, [switch]$Full)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path 'node_modules\playwright-core')) {
  Write-Host 'Installation des dependances...'
  & npm.cmd ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'npm ci a echoue.' }
}

$browserCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$browser = $browserCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { throw 'Chrome ou Edge est requis.' }

if (-not $Full -and -not $Audit) {
  $choice = Read-Host 'Appliquer les etiquettes d echange ? [O/n]'
  if ($choice -match '^[nN]') { $Audit = $true }
}

$email = Read-Host 'Adresse courriel WikiMasters'
$password = Read-Host 'Mot de passe WikiMasters' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)

try {
  $env:WIKIMASTERS_EMAIL = $email
  $env:WIKIMASTERS_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:CHROME_PATH = $browser
  if ($Full) {
    $env:COLLECTION_ONLY = 'false'
    $env:SCAN_COLLECTION = 'true'
    Remove-Item Env:WISHLIST_ONLY, Env:WISHLIST_SYNC, Env:WISHLIST_APPLY -ErrorAction SilentlyContinue
  } else {
    $env:WISHLIST_ONLY = 'true'
    $env:WISHLIST_APPLY = if ($Audit) { 'false' } else { 'true' }
  }

  & node.exe worker.js
  if ($LASTEXITCODE -ne 0) { throw "WikiMasters a echoue (code $LASTEXITCODE)." }

  Write-Host ''
  if ($Full) {
    Write-Host 'Ouverture et tri termines.' -ForegroundColor Green
  } else {
    Write-Host "Termine. Rapport : $PSScriptRoot\wishlist-report.json" -ForegroundColor Green
  }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:WIKIMASTERS_EMAIL, Env:WIKIMASTERS_PASSWORD, Env:CHROME_PATH, Env:COLLECTION_ONLY, Env:SCAN_COLLECTION, Env:WISHLIST_ONLY, Env:WISHLIST_SYNC, Env:WISHLIST_APPLY -ErrorAction SilentlyContinue
}
