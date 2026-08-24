param([string]$Token)

$ErrorActionPreference = 'Stop'
$runnerDirectory = Join-Path $env:LOCALAPPDATA 'WikiMasters-A-Trier\actions-runner'
$hookDirectory = Join-Path $env:LOCALAPPDATA 'WikiMasters-A-Trier\runner-hooks'
$hookPath = Join-Path $hookDirectory 'authorize-wikimasters-job.ps1'
$repositoryUrl = 'https://github.com/TheLightningD/wikimasters-a-trier'
$secureToken = $null
$bstr = [IntPtr]::Zero

try {
  if (-not $Token) {
    Write-Host 'Copiez le jeton temporaire depuis GitHub > Settings > Actions > Runners > New self-hosted runner.' -ForegroundColor Yellow
    $secureToken = Read-Host 'Jeton d inscription du runner' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  if (-not $Token) { throw 'Jeton d inscription requis.' }

  New-Item $runnerDirectory -ItemType Directory -Force | Out-Null
  New-Item $hookDirectory -ItemType Directory -Force | Out-Null
  $hook = @'
$ErrorActionPreference = 'Stop'
$expectedRepository = 'TheLightningD/wikimasters-a-trier'
$expectedWorkflowRef = 'TheLightningD/wikimasters-a-trier/.github/workflows/live.yml@refs/heads/main'
$allowedEvents = @('schedule', 'workflow_dispatch')
if ($env:GITHUB_REPOSITORY -ne $expectedRepository -or
    $env:GITHUB_WORKFLOW_REF -ne $expectedWorkflowRef -or
    $env:GITHUB_REF -ne 'refs/heads/main' -or
    $allowedEvents -notcontains $env:GITHUB_EVENT_NAME) {
  Write-Error "Refused self-hosted job: repository=$env:GITHUB_REPOSITORY workflow=$env:GITHUB_WORKFLOW_REF ref=$env:GITHUB_REF event=$env:GITHUB_EVENT_NAME"
  exit 1
}
Write-Host 'Authorized WikiMasters live job.'
'@
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($hookPath, $hook, $utf8)
  $runnerEnvPath = Join-Path $runnerDirectory '.env'
  $runnerEnvLines = if (Test-Path $runnerEnvPath) {
    @(Get-Content $runnerEnvPath | Where-Object { $_ -notmatch '^ACTIONS_RUNNER_HOOK_JOB_STARTED=' })
  } else { @() }
  $runnerEnvLines += "ACTIONS_RUNNER_HOOK_JOB_STARTED=$hookPath"
  [IO.File]::WriteAllLines($runnerEnvPath, $runnerEnvLines, $utf8)

  if (Test-Path (Join-Path $runnerDirectory '.runner')) {
    Write-Host "Runner deja configure dans $runnerDirectory" -ForegroundColor Green
    Write-Host 'Lancez demarrer-runner-github.cmd.'
    exit 0
  }

  Write-Host 'Recherche de la derniere version du runner GitHub...'
  $headers = @{ 'User-Agent' = 'WikiMasters-A-Trier' }
  $release = Invoke-RestMethod 'https://api.github.com/repos/actions/runner/releases/latest' -Headers $headers
  $asset = $release.assets | Where-Object { $_.name -match '^actions-runner-win-x64-.*\.zip$' } | Select-Object -First 1
  if (-not $asset) { throw 'Archive Windows x64 du runner introuvable.' }

  $archive = Join-Path $env:TEMP $asset.name
  Invoke-WebRequest $asset.browser_download_url -OutFile $archive -Headers $headers
  if ($asset.digest -match '^sha256:(.+)$') {
    $actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Matches[1].ToLowerInvariant()) { throw 'Empreinte du runner GitHub invalide.' }
  }
  Expand-Archive $archive -DestinationPath $runnerDirectory -Force
  Remove-Item $archive -Force

  Push-Location $runnerDirectory
  try {
    & .\config.cmd --unattended --replace --url $repositoryUrl --token $Token --name "$env:COMPUTERNAME-wikimasters" --labels wikimasters --work _work
    if ($LASTEXITCODE -ne 0) { throw "Configuration du runner echouee (code $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }

  Write-Host ''
  Write-Host 'Runner GitHub configure.' -ForegroundColor Green
  Write-Host 'Ne l installez pas comme service : Chrome doit rester visible pour Cloudflare.' -ForegroundColor Yellow
  Write-Host 'Double-cliquez maintenant sur demarrer-runner-github.cmd et laissez la fenetre ouverte.'
} finally {
  $Token = $null
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
