<#
Deploy Glowdays to AWS.

Idempotent: safe to re-run. First run creates the stack, later runs update the
function code in place, which is the fast path.

Nothing here is destructive. It creates or updates an artefact bucket, a media
bucket, an IAM role, a log group and a Lambda function. It never deletes the
media bucket, which is retained even if the stack is torn down.

  ./scripts/deploy.ps1 -DatabaseUrl "postgres://...?sslmode=require" `
                       -YoucamApiKey "..." [-Stage prod] [-CodeOnly]

-CodeOnly skips CloudFormation and only pushes new code. Use it for every deploy
after the first.
#>

[CmdletBinding()]
param(
  [string]$Stage = 'prod',
  [string]$Region = 'us-east-1',
  [string]$DatabaseUrl,
  [string]$YoucamApiKey,
  # Left blank on the first deploy and generated, so nobody has to invent one and
  # nobody is tempted to reuse a password they already have.
  [string]$DemoAccessCode,
  [string]$SessionSigningSecret,
  [ValidateSet('live', 'fixture')][string]$YoucamMode = 'live',
  [ValidateSet('surfaced', 'all')][string]$ConcernSet = 'surfaced',
  [switch]$CodeOnly
)

function New-Secret([int]$Bytes) {
  # RNGCryptoServiceProvider, not RandomNumberGenerator::Fill.
  #
  # Fill() is .NET Core only. On PowerShell 5.1, which runs on .NET Framework, the
  # call fails with MethodNotFound - and because the buffer had already been
  # allocated, it stayed all zeros and produced "AAAAAAAAAAAAAAAA" as an access
  # code and 32 zero bytes as a token signing key. It looked like a generated
  # secret and was in fact a constant.
  #
  # Verified non-zero below, so a silent failure of this kind cannot recur.
  $buffer = [byte[]]::new($Bytes)
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }

  if (($buffer | Where-Object { $_ -ne 0 }).Count -eq 0) {
    throw 'Secret generation produced only zero bytes. Refusing to deploy a predictable secret.'
  }

  # Base64url: safe to paste into a URL, a shell, or a judging form.
  [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# Continue, not Stop. Under Stop, PowerShell turns anything a native command
# writes to stderr into a terminating error - and esbuild, pnpm and the AWS CLI
# all write ordinary progress there. The script checks $LASTEXITCODE after every
# external call instead, which tests what actually failed rather than what
# happened to print.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$stackName = "glowdays-$Stage"

# ---------------------------------------------------------------- identity

Write-Host '== checking credentials ==' -ForegroundColor Cyan
$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
$accountId = $identity.Account
Write-Host "account $accountId, region $Region"

if ($identity.Arn -like '*:root') {
  Write-Warning 'These are root credentials. Create an IAM user with only the permissions this deploy needs, and delete the root access keys.'
}

$artifactBucket = "glowdays-artifacts-$accountId-$Region"

# ------------------------------------------------------------------- build

Write-Host '== building ==' -ForegroundColor Cyan
pnpm -r build
if ($LASTEXITCODE -ne 0) { throw 'build failed' }

node scripts/bundle-api.mjs
if ($LASTEXITCODE -ne 0) { throw 'bundle failed' }

# A content hash in the key means every deploy is a distinct object, so a
# rollback is just pointing the function at an earlier key.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$zipName = "api-$stamp.zip"
$zipPath = Join-Path $root "dist-deploy\$zipName"

Write-Host '== packaging ==' -ForegroundColor Cyan
# Zip the contents of dist-deploy, not the folder itself: Lambda expects
# index.mjs at the archive root.
Push-Location (Join-Path $root 'dist-deploy')
try {
  Get-ChildItem -Exclude '*.zip' | Compress-Archive -DestinationPath $zipPath -Force
}
finally { Pop-Location }

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "$zipName is $sizeMb MB"
if ($sizeMb -gt 50) {
  throw "Artefact is ${sizeMb} MB. Lambda's direct upload limit is 50 MB zipped."
}

# ------------------------------------------------------------------ upload

Write-Host '== uploading ==' -ForegroundColor Cyan
$bucketExists = $true
aws s3api head-bucket --bucket $artifactBucket 2>$null
if ($LASTEXITCODE -ne 0) { $bucketExists = $false }

if (-not $bucketExists) {
  Write-Host "creating $artifactBucket"
  if ($Region -eq 'us-east-1') {
    aws s3api create-bucket --bucket $artifactBucket --region $Region | Out-Null
  }
  else {
    aws s3api create-bucket --bucket $artifactBucket --region $Region `
      --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
  }
  # Build artefacts are not secret, but they are not public either.
  aws s3api put-public-access-block --bucket $artifactBucket `
    --public-access-block-configuration 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' | Out-Null
  aws s3api put-bucket-encryption --bucket $artifactBucket `
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' | Out-Null
}

$artifactKey = "api/$zipName"
aws s3 cp $zipPath "s3://$artifactBucket/$artifactKey" --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'upload failed' }

# ------------------------------------------------------------------ deploy

if ($CodeOnly) {
  Write-Host '== updating function code ==' -ForegroundColor Cyan
  aws lambda update-function-code `
    --function-name "glowdays-api-$Stage" `
    --s3-bucket $artifactBucket --s3-key $artifactKey `
    --region $Region --output json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'code update failed' }
  aws lambda wait function-updated --function-name "glowdays-api-$Stage" --region $Region
}
else {
  if (-not $DatabaseUrl) { throw 'DatabaseUrl is required on the first deploy' }
  if (-not $YoucamApiKey) { throw 'YoucamApiKey is required on the first deploy' }
  if ($DatabaseUrl -notmatch 'sslmode=(require|verify-ca|verify-full)') {
    throw 'DatabaseUrl must set sslmode=require. The application refuses a remote URL without it.'
  }

  if (-not $DemoAccessCode) {
    $DemoAccessCode = New-Secret 12
    Write-Host "generated access code: $DemoAccessCode" -ForegroundColor Yellow
    Write-Host '  ^ this is what a reviewer types to sign in. Save it now.' -ForegroundColor Yellow
  }
  if (-not $SessionSigningSecret) { $SessionSigningSecret = New-Secret 32 }

  Write-Host '== deploying stack ==' -ForegroundColor Cyan
  aws cloudformation deploy `
    --template-file infra/glowdays.yaml `
    --stack-name $stackName `
    --region $Region `
    --capabilities CAPABILITY_IAM `
    --no-fail-on-empty-changeset `
    --parameter-overrides `
    "Stage=$Stage" `
    "ArtifactBucket=$artifactBucket" `
    "ArtifactKey=$artifactKey" `
    "DatabaseUrl=$DatabaseUrl" `
    "YoucamApiKey=$YoucamApiKey" `
    "DemoAccessCode=$DemoAccessCode" `
    "SessionSigningSecret=$SessionSigningSecret" `
    "YoucamMode=$YoucamMode" `
    "ConcernSet=$ConcernSet"
  if ($LASTEXITCODE -ne 0) { throw 'stack deploy failed' }
}

# ------------------------------------------------------------------- verify

Write-Host '== verifying ==' -ForegroundColor Cyan

# The stack output is the Lambda Function URL, which is not the public door.
#
# That URL returns 403 on every path despite a textbook resource policy,
# AuthType NONE and no SCP or RCP in the way; direct `lambda invoke` proves the
# function itself is fine. An API Gateway HTTP API was put in front instead, and
# its address lives in deployed-url.txt.
#
# Verifying the Function URL therefore failed every single time and printed a
# warning that looked like a broken deploy while the app was actually serving
# traffic. Checking the address people really use is the whole point of a smoke
# check, so that is what is checked, with the stack output only as a fallback.
$publicUrlFile = Join-Path $root 'deployed-url.txt'
if (Test-Path $publicUrlFile) {
  $url = (Get-Content $publicUrlFile -Raw).Trim().TrimEnd('/') + '/'
  Write-Host "url: $url (API Gateway, from deployed-url.txt)"
  Write-Warning 'The API Gateway HTTP API is not in the CloudFormation template. Recreating the stack will not recreate it.'
}
else {
  $url = (aws cloudformation describe-stacks --stack-name $stackName --region $Region `
      --query "Stacks[0].Outputs[?OutputKey=='Url'].OutputValue" --output text).Trim()
  Write-Host "url: $url (Lambda Function URL, from the stack output)"
}

# Readiness, not liveness. Liveness answers from configuration alone and would
# report healthy with an unreachable database.
$ready = $false
for ($i = 0; $i -lt 10; $i++) {
  try {
    $res = Invoke-WebRequest -Uri "${url}ready" -UseBasicParsing -TimeoutSec 20
    if ($res.StatusCode -eq 200) { $ready = $true; break }
  }
  catch { Start-Sleep -Seconds 3 }
}

if ($ready) {
  Write-Host 'ready: the function is up and the database is reachable' -ForegroundColor Green
}
else {
  Write-Warning "readiness did not pass. Check logs: aws logs tail /aws/lambda/glowdays-api-$Stage --follow --region $Region"
}

Write-Host ''
Write-Host 'Migrations are not run automatically. From this machine:' -ForegroundColor Yellow
Write-Host '  $env:DATABASE_URL="<the same url>"; pnpm --filter @glowdays/api db:migrate'
Write-Host ''
Write-Host "Later deploys:  ./scripts/deploy.ps1 -CodeOnly" -ForegroundColor Cyan
