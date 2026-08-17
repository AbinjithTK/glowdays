<#
Replace the demo access code and session signing secret on an already-deployed
stack.

Written as a file rather than an inline command because the first deploy silently
generated all-zero secrets: RandomNumberGenerator::Fill does not exist on
PowerShell 5.1, and the pre-allocated buffer stayed zeroed. The access code came
out as "AAAAAAAAAAAAAAAA" and the token signing key as 32 zero bytes.

Changing the signing secret invalidates every existing session, which is the
intended way to revoke access.
#>

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$region = 'us-east-1'
$stack = 'glowdays-prod'
$artifactBucket = 'glowdays-artifacts-476114109859-us-east-1'

function New-Secret([int]$Bytes) {
  $buffer = [byte[]]::new($Bytes)
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  if (($buffer | Where-Object { $_ -ne 0 }).Count -eq 0) {
    throw 'Secret generation produced only zero bytes. Refusing to continue.'
  }
  [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# Read the key from .env so it is never typed on a command line or into history.
$envmap = @{}
Get-Content (Join-Path $root '.env') | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
  $i = $_.IndexOf('=')
  if ($i -gt 0) { $envmap[$_.Substring(0, $i)] = $_.Substring($i + 1) }
}
$youcamKey = $envmap['YOUCAM_API_KEY']
if (-not $youcamKey) { throw 'YOUCAM_API_KEY is not in .env' }

# Read the live connection string back from the deployed function rather than
# holding a copy here.
#
# This line used to be a hardcoded Neon URL, password included, six lines below a
# comment explaining that the YouCam key is read from .env precisely so it never
# lands in a file. It was committed to a public repository and Neon's own scanner
# found it within the hour. The credential has been rotated.
#
# The deployed configuration is the only place this value needs to exist, so it is
# the only place it is read from. If the rotation being performed is the database
# password itself, pass -DatabaseUrl explicitly instead.
if (-not $DatabaseUrl) {
  $DatabaseUrl = (aws lambda get-function-configuration `
      --function-name "glowdays-api-$Stage" --region $region `
      --query "Environment.Variables.DATABASE_URL" --output text).Trim()
}
if (-not $DatabaseUrl -or $DatabaseUrl -eq 'None') {
  throw 'Could not read DATABASE_URL from the deployed function. Pass -DatabaseUrl.'
}
$databaseUrl = $DatabaseUrl

$code = New-Secret 12
$sign = New-Secret 32

# Reuse whatever artefact is already deployed rather than rebuilding, so this
# changes configuration only.
$currentKey = (aws cloudformation describe-stacks --stack-name $stack --region $region `
    --query "Stacks[0].Parameters[?ParameterKey=='ArtifactKey'].ParameterValue" --output text).Trim()
if (-not $currentKey -or $currentKey -eq 'None') { throw 'Could not read the deployed ArtifactKey' }
Write-Host "reusing artefact $currentKey"

aws cloudformation deploy `
  --template-file infra/glowdays.yaml `
  --stack-name $stack `
  --region $region `
  --capabilities CAPABILITY_IAM `
  --no-fail-on-empty-changeset `
  --parameter-overrides `
  "Stage=prod" `
  "ArtifactBucket=$artifactBucket" `
  "ArtifactKey=$currentKey" `
  "DatabaseUrl=$databaseUrl" `
  "YoucamApiKey=$youcamKey" `
  "YoucamMode=live" `
  "DemoAccessCode=$code" `
  "SessionSigningSecret=$sign" `
  "ConcernSet=surfaced"

if ($LASTEXITCODE -ne 0) { throw 'stack update failed' }

$url = (aws cloudformation describe-stacks --stack-name $stack --region $region `
    --query "Stacks[0].Outputs[?OutputKey=='Url'].OutputValue" --output text).Trim()

# Written to files rather than only printed, because the terminal here truncates
# long lines and an access code that arrives half-copied is worse than useless.
Set-Content -Path (Join-Path $root 'access-code.txt') -Value $code -NoNewline
Set-Content -Path (Join-Path $root 'deployed-url.txt') -Value $url -NoNewline

Write-Host ''
Write-Host "url:         $url"
Write-Host "access code: $code"
Write-Host 'Both written to deployed-url.txt and access-code.txt'
