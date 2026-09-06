[CmdletBinding()]
param(
    [string]$EnvPath = (Join-Path (Split-Path -Parent $PSScriptRoot) ".env")
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$examplePath = Join-Path $root ".env.example"
$isNewFile = -not (Test-Path $EnvPath)

if ($isNewFile) {
    if (-not (Test-Path $examplePath)) {
        throw "Fichier .env.example introuvable: $examplePath"
    }
    Copy-Item $examplePath $EnvPath
}

function Get-DotEnvValue {
    param([Parameter(Mandatory = $true)][string]$Name)
    $match = Select-String -Path $EnvPath -Pattern ("^" + [regex]::Escape($Name) + "=(.*)$") | Select-Object -Last 1
    if (-not $match) { return "" }
    return $match.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Set-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value
    )
    [string[]]$lines = @(Get-Content -Path $EnvPath)
    $prefix = "$Name="
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index].StartsWith($prefix, [System.StringComparison]::Ordinal)) {
            $lines[$index] = "$Name=$Value"
            $found = $true
        }
    }
    if (-not $found) { $lines += "$Name=$Value" }
    [System.IO.File]::WriteAllLines($EnvPath, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
}

function New-SecureHex {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function Ensure-RandomValue {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [int]$Bytes = 32,
        [string]$Prefix = "",
        [int]$MinLength = 16
    )
    $current = Get-DotEnvValue $Name
    if ([string]::IsNullOrWhiteSpace($current) -or $current.Length -lt $MinLength -or $current -match "CHANGE_ME|remplacez|your_") {
        $current = $Prefix + (New-SecureHex $Bytes)
        Set-DotEnvValue $Name $current
        return @{ Value = $current; Generated = $true }
    }
    return @{ Value = $current; Generated = $false }
}

$secretKey = Ensure-RandomValue -Name "SECRET_KEY" -Bytes 64 -MinLength 64
$legacySalt = Ensure-RandomValue -Name "LEGACY_SHA256_SALT" -Bytes 32 -MinLength 32
$postgres = Ensure-RandomValue -Name "POSTGRES_PASSWORD" -Bytes 32 -MinLength 20
# [51] - QDRANT_API_KEY supprimee : le RAG vit dans PostgreSQL (pgvector).
$grafana = Ensure-RandomValue -Name "GRAFANA_ADMIN_PASSWORD" -Bytes 24 -MinLength 20
$owner = Ensure-RandomValue -Name "NARCHI_OWNER_PASSWORD" -Bytes 20 -Prefix "N5!" -MinLength 16
$admin = Ensure-RandomValue -Name "NARCHI_ADMIN_PASSWORD" -Bytes 20 -Prefix "N5!" -MinLength 16

$flowerCurrent = Get-DotEnvValue "FLOWER_BASIC_AUTH"
$flowerGenerated = $false
if ([string]::IsNullOrWhiteSpace($flowerCurrent) -or $flowerCurrent -notmatch "^[^:]+:.+") {
    $flowerCurrent = "admin:" + (New-SecureHex 24)
    Set-DotEnvValue "FLOWER_BASIC_AUTH" $flowerCurrent
    $flowerGenerated = $true
}

Set-DotEnvValue "ENVIRONMENT" "production"
$dbUser = Get-DotEnvValue "POSTGRES_USER"
$dbName = Get-DotEnvValue "POSTGRES_DB"
if ([string]::IsNullOrWhiteSpace($dbUser)) { $dbUser = "narchi"; Set-DotEnvValue "POSTGRES_USER" $dbUser }
if ([string]::IsNullOrWhiteSpace($dbName)) { $dbName = "narchi_v3"; Set-DotEnvValue "POSTGRES_DB" $dbName }
Set-DotEnvValue "DATABASE_URL" ("postgresql://" + $dbUser + ":" + $postgres.Value + "@pgbouncer:5432/" + $dbName)

$existingSeedFlag = (Get-DotEnvValue "NARCHI_SEED_DEFAULT_ADMINS") -eq "true"
$seedRequested = $existingSeedFlag -or $isNewFile -or $owner.Generated -or $admin.Generated
if ($seedRequested) {
    Set-DotEnvValue "NARCHI_SEED_DEFAULT_ADMINS" "true"
}

[PSCustomObject]@{
    EnvPath = $EnvPath
    Created = $isNewFile
    SeedRequested = $seedRequested
    OwnerEmail = (Get-DotEnvValue "NARCHI_OWNER_EMAIL")
    OwnerPassword = $owner.Value
    OwnerPasswordGenerated = $owner.Generated
    AdminEmail = (Get-DotEnvValue "NARCHI_ADMIN_EMAIL")
    AdminPassword = $admin.Value
    AdminPasswordGenerated = $admin.Generated
    GrafanaPassword = $grafana.Value
    GrafanaPasswordGenerated = $grafana.Generated
    FlowerBasicAuth = $flowerCurrent
    FlowerBasicAuthGenerated = $flowerGenerated
}
