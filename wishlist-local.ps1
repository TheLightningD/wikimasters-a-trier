param([switch]$Audit, [switch]$Full, [switch]$ResetCredentials)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$totalSteps = if ($Full) { 5 } else { 4 }
$modeTitle = if ($Full) { 'OUVRIR ET TRIER' } elseif ($Audit) { 'AUDIT DES ÉCHANGES' } else { 'SYNCHRONISER LES ÉCHANGES' }
$timer = [Diagnostics.Stopwatch]::StartNew()
function Write-Info {
  param([string]$Label, [string]$Value = '')
  if ($Value) { Write-Host "  • $Label : $Value" -ForegroundColor DarkGray }
  else { Write-Host "  • $Label" -ForegroundColor DarkGray }
}
function Write-Done {
  param([string]$Label)
  Write-Host "  ✓ $Label" -ForegroundColor Green
}

Write-Host ''
Write-Host "WikiMasters — $modeTitle" -ForegroundColor Cyan
Write-Host ('=' * (14 + $modeTitle.Length)) -ForegroundColor DarkGray
Write-Host "[1/$totalSteps] Préparation" -ForegroundColor Yellow

if (-not (Test-Path 'node_modules\playwright-core')) {
  Write-Info 'Dépendances npm' 'installation en cours'
  & npm.cmd ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'npm ci a échoué.' }
  Write-Done 'Dépendances npm installées'
} else {
  Write-Info 'Dépendances npm' 'déjà prêtes'
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
Write-Info 'Navigateur' $([IO.Path]::GetFileNameWithoutExtension($browser))

if (-not $Full -and -not $Audit) {
  $choice = Read-Host "Appliquer les étiquettes d'échange ? [O/n]"
  if ($choice -match '^[nN]') { $Audit = $true }
}
if (-not $Full) {
  Write-Info 'Mode' $(if ($Audit) { 'audit sans modification' } else { 'application des étiquettes' })
}

$credentialDirectory = Join-Path $env:LOCALAPPDATA 'WikiMasters-A-Trier'
$credentialPath = Join-Path $credentialDirectory 'credentials.xml'
if ($ResetCredentials) { Remove-Item $credentialPath -Force -ErrorAction SilentlyContinue }

$credential = $null
if (Test-Path $credentialPath) {
  try {
    $credential = Import-Clixml $credentialPath
    if ($credential -isnot [System.Management.Automation.PSCredential] -or -not $credential.UserName) { throw 'Identifiants invalides' }
  } catch {
    Write-Warning 'Identifiants enregistres illisibles ; nouvelle saisie requise.'
    $credential = $null
    Remove-Item $credentialPath -Force -ErrorAction SilentlyContinue
  }
}
if (-not $credential) {
  $email = Read-Host 'Adresse courriel WikiMasters'
  $password = Read-Host 'Mot de passe WikiMasters' -AsSecureString
  $credential = [System.Management.Automation.PSCredential]::new($email, $password)
  New-Item $credentialDirectory -ItemType Directory -Force | Out-Null
  $credential | Export-Clixml $credentialPath
  Write-Info 'Identifiants' 'chiffrés par Windows et enregistrés'
}
Write-Info 'Identifiants' 'prêts'
Write-Done 'Préparation terminée'

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
$exitCode = 0

try {
  $env:WIKIMASTERS_EMAIL = $credential.UserName
  $env:WIKIMASTERS_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:CHROME_PATH = $browser
  $env:WM_BROWSER_PROFILE = Join-Path $credentialDirectory 'browser-profile'
  $env:WM_MANUAL_LOGIN_HANDOFF = 'true'
  $env:WM_PRETTY_OUTPUT = 'true'
  $env:WM_MACHINE_OUTPUT = 'false'
  $env:WM_HEADLESS = 'false'
  if ($Full) {
    $env:COLLECTION_ONLY = 'false'
    $env:SCAN_COLLECTION = 'true'
    Remove-Item Env:WISHLIST_ONLY, Env:WISHLIST_SYNC, Env:WISHLIST_APPLY -ErrorAction SilentlyContinue
  } else {
    $env:WISHLIST_ONLY = 'true'
    $env:WISHLIST_APPLY = if ($Audit) { 'false' } else { 'true' }
  }

  & node.exe worker.js
  $workerExitCode = $LASTEXITCODE
  if ($workerExitCode -eq 42) {
    Write-Host ''
    Write-Host "[2/$totalSteps] Connexion via Chrome normal" -ForegroundColor Yellow
    Write-Info 'Cloudflare' 'validation dans Chrome normal'
    Write-Info 'Connexion' 'identifiants et bouton gérés automatiquement'
    $portListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $portListener.Start()
    $debugPort = $portListener.LocalEndpoint.Port
    $portListener.Stop()
    $env:WM_CDP_ENDPOINT = "http://127.0.0.1:$debugPort"
    $manualArguments = @(
      "--user-data-dir=`"$env:WM_BROWSER_PROFILE`""
      '--remote-debugging-address=127.0.0.1'
      "--remote-debugging-port=$debugPort"
      '--no-first-run'
      '--no-default-browser-check'
      '--disable-background-mode'
      'https://www.wiki-masters.com/pulls'
    )
    $manualBrowser = Start-Process -FilePath $browser -ArgumentList $manualArguments -PassThru
    Start-Sleep -Seconds 2
    & node.exe worker.js
    $workerExitCode = $LASTEXITCODE
    if (-not $manualBrowser.HasExited) {
      $manualBrowser.CloseMainWindow() | Out-Null
      $manualBrowser.WaitForExit(5000) | Out-Null
    }
  }
  if ($workerExitCode -eq 42) { throw "La reprise dans Chrome normal n’a pas démarré." }
  if ($workerExitCode -ne 0) { throw "WikiMasters a échoué (code $workerExitCode)." }

  Write-Host ''
  $timer.Stop()
  if ($Full) {
    Write-Host "TERMINÉ — Ouverture et tri réussis en $([Math]::Round($timer.Elapsed.TotalSeconds)) s." -ForegroundColor Green
  } else {
    Write-Host "TERMINÉ — Rapport : $PSScriptRoot\wishlist-report.json" -ForegroundColor Green
  }
} catch {
  $timer.Stop()
  $exitCode = 1
  Write-Host ''
  Write-Host "ÉCHEC — $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Durée avant échec : $([Math]::Round($timer.Elapsed.TotalSeconds)) s." -ForegroundColor DarkGray
  Write-Host "L’étape et la cause détaillée sont affichées juste au-dessus." -ForegroundColor DarkGray
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:WIKIMASTERS_EMAIL, Env:WIKIMASTERS_PASSWORD, Env:CHROME_PATH, Env:WM_BROWSER_PROFILE, Env:WM_MANUAL_LOGIN_HANDOFF, Env:WM_CDP_ENDPOINT, Env:COLLECTION_ONLY, Env:SCAN_COLLECTION, Env:WISHLIST_ONLY, Env:WISHLIST_SYNC, Env:WISHLIST_APPLY, Env:WM_PRETTY_OUTPUT, Env:WM_MACHINE_OUTPUT, Env:WM_HEADLESS -ErrorAction SilentlyContinue
}
if ($exitCode -ne 0) { exit $exitCode }
