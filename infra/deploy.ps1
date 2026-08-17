# Glowdays deployment, AWS CLI only.
#
# WHY THIS SHAPE
#
# Lambda with a Function URL, not a container on ECS or App Runner. Three
# reasons, in order of how much they mattered:
#
#  1. The camera needs a secure context, so the deployed app must be HTTPS. A
#     Function URL is HTTPS on an AWS-issued domain with no certificate, no load
#     balancer and no domain purchase. An ALB in front of Fargate serves plain
#     HTTP until you add a domain and an ACM certificate, and plain HTTP means
#     no camera at all.
#  2. There is no Docker on this machine, so ECR and App Runner's image source
#     are both unavailable. A zip needs no container runtime.
#  3. Default Lambda networking has public egress, which the YouCam calls need.
#     Putting compute in a VPC to reach a private RDS instance removes that
#     egress unless a NAT gateway is added - more moving parts and a standing
#     hourly charge.
#
# The database is deliberately NOT RDS. Reaching a private RDS instance requires
# the VPC attachment described above. A Postgres reachable over public TLS keeps
# the function outside a VPC, and DATABASE_URL is a one-line swap by design, so
# moving to RDS later is a configuration change plus the VPC work.
#
# WHAT THIS CREATES, and what it costs
#
#   S3 bucket            pennies at demo volume
#   IAM role and policy  free
#   Lambda function      free tier covers this comfortably
#   Function URL         free
#
# Everything is idempotent. Re-running updates rather than duplicating.
#
# USAGE
#   ./infra/deploy.ps1 -DatabaseUrl "postgres://...?sslmode=require" `
#                      -DemoAccessCode "some-long-shared-code" `
#                      -YouCamApiKey "..."        # omit to deploy in fixture mode
#
# Run migrations separately, against the same database, before first use:
#   $env:DATABASE_URL="postgres://...?sslmode=require"
#   pnpm --filter @glowdays/api db:migrate

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DatabaseUrl,
  [Parameter(Mandatory = $true)][string]$DemoAccessCode,
  [string]$YouCamApiKey = "",
  [string]$Name = "glowdays",
  [string]$Region = "us-east-1",
  [ValidateSet("surfaced", "all")][string]$ConcernSet = "surfaced",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StageDir = Join-Path $RepoRoot ".deploy"
$ZipPath = Join-Path $StageDir "$Name-api.zip"
$FunctionName = "$Name-api"
$RoleName = "$Name-api-role"

function Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Note($message) { Write-Host "    $message" -ForegroundColor DarkGray }
function Fail($message) { Write-Host "!!! $message" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- preflight

Step "Preflight"

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { Fail "aws CLI not found." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "pnpm not found." }

$identity = aws sts get-caller-identity --output json 2>$null | ConvertFrom-Json
if (-not $identity) { Fail "AWS credentials are not working. Run 'aws configure'." }
$AccountId = $identity.Account
Note "account $AccountId, region $Region"

if ($identity.Arn -match ":root$") {
  Write-Host "    WARNING: these are account root credentials." -ForegroundColor Yellow
  Write-Host "    Root keys cannot be scoped or rotated per service, and a leak" -ForegroundColor Yellow
  Write-Host "    costs the whole account. Create an IAM user with only the" -ForegroundColor Yellow
  Write-Host "    permissions this script needs and switch to it." -ForegroundColor Yellow
}

# The refusals below exist in the application config too. Checked here as well so
# a bad combination fails before anything is created, rather than after.
if ($DatabaseUrl -notmatch "sslmode=(require|verify-ca|verify-full)") {
  Fail "DatabaseUrl must set sslmode=require. RDS and Neon both accept unencrypted connections silently otherwise."
}
if ($DatabaseUrl -like "pglite://*") {
  Fail "The embedded database cannot be deployed. It is single-connection and in-process."
}
if ($DemoAccessCode.Length -lt 12) {
  Fail "DemoAccessCode must be at least 12 characters. It is the only thing between a public URL and an account."
}

$BucketName = "$Name-scans-$AccountId"

# ------------------------------------------------------------------- build

if (-not $SkipBuild) {
  Step "Building"
  Push-Location $RepoRoot
  try {
    pnpm -r build
    if ($LASTEXITCODE -ne 0) { Fail "Build failed." }
  } finally { Pop-Location }
}

$WebDist = Join-Path $RepoRoot "apps/web/dist"
if (-not (Test-Path (Join-Path $WebDist "index.html"))) {
  Fail "No built web app at apps/web/dist. Run without -SkipBuild."
}

# ------------------------------------------------------------------ package

Step "Packaging"

if (Test-Path $StageDir) { Remove-Item -Recurse -Force $StageDir }
New-Item -ItemType Directory -Path $StageDir | Out-Null
$AppDir = Join-Path $StageDir "api"

Push-Location $RepoRoot
try {
  # `pnpm deploy` resolves the workspace dependency on @glowdays/core and writes
  # a real node_modules tree rather than the symlink farm pnpm normally uses.
  # Zipping the symlinked layout produces a function that cannot resolve its own
  # dependencies. --prod also drops the embedded database, which ships a large
  # WebAssembly build that production never loads.
  pnpm deploy --filter=@glowdays/api --prod --legacy $AppDir
  if ($LASTEXITCODE -ne 0) { Fail "pnpm deploy failed." }
} finally { Pop-Location }

# The built UI travels with the API so the whole product is one origin. Placed
# where WEB_DIST_DIR points, relative to the function's working directory.
$BundledWeb = Join-Path $AppDir "web-dist"
Copy-Item -Recurse -Path $WebDist -Destination $BundledWeb
Note "bundled the web app into web-dist"

# Source maps roughly double the archive and are of no use in CloudWatch.
Get-ChildItem -Path (Join-Path $AppDir "dist") -Recurse -Filter *.map -ErrorAction SilentlyContinue |
  Remove-Item -Force

# Tests never run in the function and are a meaningful share of the archive.
Get-ChildItem -Path (Join-Path $AppDir "dist") -Recurse -Filter *.test.js -ErrorAction SilentlyContinue |
  Remove-Item -Force

# Development artefacts, in case a stale bundle is being reused.
foreach ($junk in @(".pgdata", ".storage")) {
  $path = Join-Path $AppDir $junk
  if (Test-Path $path) { Remove-Item -Recurse -Force $path }
}

Step "Zipping"

# pnpm's content-addressed store carries 1970 timestamps on some files, and the
# zip format cannot represent a year before 1980. Both Compress-Archive and
# ZipFile throw on those, so they are normalised first. This is not cosmetic -
# it is the difference between an archive and an exception.
$stamp = Get-Date "2026-01-01T00:00:00"
$fixed = 0
Get-ChildItem $AppDir -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.LastWriteTime.Year -lt 1981) {
    try { $_.LastWriteTime = $stamp; $fixed++ } catch { }
  }
}
if ($fixed -gt 0) { Note "normalised $fixed pre-1980 timestamps" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  (Resolve-Path $AppDir).Path, $ZipPath,
  [System.IO.Compression.CompressionLevel]::Optimal, $false)

$ZipMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Note "$ZipMb MB"

# Direct upload is capped at 50MB; via S3 the limit is 250MB unzipped. The AWS
# SDK alone is most of the weight here, so crossing 45MB is expected rather than
# a sign something is wrong.
$UseS3ForCode = $ZipMb -gt 45
if ($UseS3ForCode) { Note "over 45MB, so the code will be uploaded through S3" }

# ------------------------------------------------------------------ storage

Step "S3 bucket for check-in photos"

$bucketExists = $true
aws s3api head-bucket --bucket $BucketName 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { $bucketExists = $false }

if (-not $bucketExists) {
  # us-east-1 rejects a LocationConstraint, every other region requires one.
  if ($Region -eq "us-east-1") {
    aws s3api create-bucket --bucket $BucketName --region $Region | Out-Null
  } else {
    aws s3api create-bucket --bucket $BucketName --region $Region `
      --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
  }
  Note "created $BucketName"
} else {
  Note "$BucketName already exists"
}

# These objects are photographs of faces. Public access is blocked at the bucket
# level as well as by never granting a public ACL, so a later mistake in one
# place does not expose them.
aws s3api put-public-access-block --bucket $BucketName `
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" | Out-Null

aws s3api put-bucket-encryption --bucket $BucketName `
  --server-side-encryption-configuration '{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"AES256\"},\"BucketKeyEnabled\":true}]}' | Out-Null

aws s3api put-bucket-versioning --bucket $BucketName `
  --versioning-configuration "Status=Suspended" | Out-Null

Note "public access blocked, AES256 encryption on"

# ---------------------------------------------------------------- iam role

Step "IAM role"

$trust = '{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"lambda.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}'

aws iam get-role --role-name $RoleName 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  aws iam create-role --role-name $RoleName --assume-role-policy-document $trust | Out-Null
  Note "created $RoleName"
} else {
  Note "$RoleName already exists"
}

aws iam attach-role-policy --role-name $RoleName `
  --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" | Out-Null

# Scoped to this bucket and to the four actions the storage adapter uses. No
# s3:* and no wildcard resource: a compromised function should not be able to
# reach anything else in the account.
$s3Policy = '{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:GetObject\",\"s3:DeleteObject\",\"s3:ListBucket\"],\"Resource\":[\"arn:aws:s3:::' + $BucketName + '\",\"arn:aws:s3:::' + $BucketName + '/*\"]}]}'

aws iam put-role-policy --role-name $RoleName --policy-name "$Name-scan-storage" `
  --policy-document $s3Policy | Out-Null
Note "storage policy scoped to $BucketName"

$RoleArn = "arn:aws:iam::${AccountId}:role/$RoleName"

# ----------------------------------------------------------------- function

Step "Lambda function"

# Staged in the same bucket rather than a second one. It is already private,
# already encrypted, and the key prefix keeps it clearly separate from scans.
$CodeKey = "deploy/$FunctionName.zip"
if ($UseS3ForCode) {
  aws s3api put-object --bucket $BucketName --key $CodeKey --body $ZipPath | Out-Null
  Note "uploaded code to s3://$BucketName/$CodeKey"
}

$youcamMode = if ($YouCamApiKey) { "live" } else { "fixture" }
if ($youcamMode -eq "fixture") {
  Write-Host "    WARNING: no YouCamApiKey given, deploying in fixture mode." -ForegroundColor Yellow
  Write-Host "    Scores will be generated locally. Nothing is really analysed." -ForegroundColor Yellow
}

# Note what is absent as much as what is present. ENABLE_DEV_ROUTES is not set,
# so /dev/token - which mints a session for any account with no credentials - is
# not mounted. AUTH_MODE is demo rather than dev, which config refuses in
# production anyway.
$envPairs = @(
  "NODE_ENV=production",
  "DATABASE_URL=$DatabaseUrl",
  "AUTH_MODE=demo",
  "DEMO_ACCESS_CODE=$DemoAccessCode",
  "DEV_AUTH_SECRET=$DemoAccessCode-signing",
  "STORAGE_DRIVER=s3",
  "S3_BUCKET=$BucketName",
  "S3_REGION=$Region",
  "SIGNED_URL_TTL_SECONDS=300",
  "YOUCAM_MODE=$youcamMode",
  "YOUCAM_TASK_VERSION=v2.1",
  "YOUCAM_CONCERN_SET=$ConcernSet",
  "WEB_DIST_DIR=web-dist",
  "CORS_ORIGINS=https://example.invalid"
)
if ($YouCamApiKey) { $envPairs += "YOUCAM_API_KEY=$YouCamApiKey" }
$envArg = "Variables={" + ($envPairs -join ",") + "}"

aws lambda get-function --function-name $FunctionName --region $Region 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  # IAM is eventually consistent, and a freshly created role is frequently not
  # yet assumable. This is the single most common first-run failure.
  Note "waiting for the role to become assumable"
  Start-Sleep -Seconds 12

  $codeArgs = if ($UseS3ForCode) {
    @("--code", "S3Bucket=$BucketName,S3Key=$CodeKey")
  } else {
    @("--zip-file", "fileb://$ZipPath")
  }

  aws lambda create-function `
    --function-name $FunctionName `
    --region $Region `
    --runtime nodejs22.x `
    --role $RoleArn `
    --handler dist/lambda.handler `
    @codeArgs `
    --timeout 30 `
    --memory-size 1024 `
    --architectures arm64 `
    --environment $envArg | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "create-function failed." }
  Note "created $FunctionName"
} else {
  if ($UseS3ForCode) {
    aws lambda update-function-code --function-name $FunctionName --region $Region `
      --s3-bucket $BucketName --s3-key $CodeKey | Out-Null
  } else {
    aws lambda update-function-code --function-name $FunctionName --region $Region `
      --zip-file "fileb://$ZipPath" | Out-Null
  }
  aws lambda wait function-updated --function-name $FunctionName --region $Region
  aws lambda update-function-configuration --function-name $FunctionName --region $Region `
    --runtime nodejs22.x --handler dist/lambda.handler --timeout 30 --memory-size 1024 `
    --environment $envArg | Out-Null
  aws lambda wait function-updated --function-name $FunctionName --region $Region
  Note "updated $FunctionName"
}

# -------------------------------------------------------------- function url

Step "Function URL"

aws lambda get-function-url-config --function-name $FunctionName --region $Region 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  # AuthType NONE is required: a browser cannot sign requests with SigV4. The
  # application's own bearer-token check is the access control, which is why the
  # demo access code has a long minimum length.
  aws lambda create-function-url-config --function-name $FunctionName --region $Region `
    --auth-type NONE | Out-Null

  aws lambda add-permission --function-name $FunctionName --region $Region `
    --statement-id "public-function-url" `
    --action "lambda:InvokeFunctionUrl" `
    --principal "*" `
    --function-url-auth-type NONE | Out-Null
  Note "created a public HTTPS endpoint"
} else {
  Note "function URL already exists"
}

$urlConfig = aws lambda get-function-url-config --function-name $FunctionName --region $Region --output json | ConvertFrom-Json
$FunctionUrl = $urlConfig.FunctionUrl.TrimEnd("/")

# Same-origin, since the function serves the UI as well, so the allowlist only
# needs its own address. Set after the URL exists because it is not knowable
# before then.
aws lambda update-function-configuration --function-name $FunctionName --region $Region `
  --environment ("Variables={" + (($envPairs | Where-Object { $_ -notlike "CORS_ORIGINS=*" }) -join ",") + ",CORS_ORIGINS=$FunctionUrl}") | Out-Null
aws lambda wait function-updated --function-name $FunctionName --region $Region

# ------------------------------------------------------------------- verify

Step "Verifying"

$ok = $false
for ($i = 0; $i -lt 10; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "$FunctionUrl/health" -TimeoutSec 25
    if ($health.ok) {
      Note "health ok, youcam=$($health.youcam), mode=$($health.mode)"
      $ok = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 4
  }
}
if (-not $ok) { Fail "The function deployed but /health did not answer. Check CloudWatch logs for /aws/lambda/$FunctionName." }

# Readiness touches the database, so this is what proves the connection string
# and the migrations, not just that the code loaded.
try {
  $ready = Invoke-RestMethod -Uri "$FunctionUrl/ready" -TimeoutSec 25
  if ($ready.ready) { Note "database reachable" }
} catch {
  Write-Host "    WARNING: /ready reports the database is unreachable." -ForegroundColor Yellow
  Write-Host "    Run the migrations against it, then retry:" -ForegroundColor Yellow
  Write-Host "      `$env:DATABASE_URL='$DatabaseUrl'; pnpm --filter @glowdays/api db:migrate" -ForegroundColor Yellow
}

# Confirm the hardening actually held rather than trusting that it did.
try {
  $devProbe = Invoke-WebRequest -Uri "$FunctionUrl/dev/token" -Method POST -Body '{}' `
    -ContentType "application/json" -TimeoutSec 20 -SkipHttpErrorCheck
  if ($devProbe.StatusCode -eq 404) {
    Note "/dev/token is closed, as it must be on a public URL"
  } else {
    Fail "/dev/token answered $($devProbe.StatusCode). It mints a session for any account. Do not share this URL."
  }
} catch {
  Note "/dev/token is unreachable"
}

Write-Host ""
Write-Host "Deployed." -ForegroundColor Green
Write-Host "  $FunctionUrl" -ForegroundColor White
Write-Host ""
Write-Host "  Sign in with any email and the access code you passed." -ForegroundColor Gray
Write-Host "  Logs:  aws logs tail /aws/lambda/$FunctionName --follow --region $Region" -ForegroundColor Gray
Write-Host ""
