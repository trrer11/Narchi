# etape 119 - RETIRER le HTTPS local : revient a l'etat HTTP 8080 seul.
# Ce que fait ce script, et ce qu'il NE fait PAS :
#   - supprime le bloc nginx 8443 (infra\\tls\\enabled\\ vide a nouveau),
#   - retire la regle de pare-feu 8443,
#   - relance le conteneur frontend puis PROUVE que 8080 repond et que
#     8443 ne repond plus ;
#   - CONSERVE les certificats (infra\\tls\\certs\\) et la CA installee :
#     les reactiver = relancer 8_ACTIVER_HTTPS_LOCAL.bat. Pour retirer
#     aussi la CA de Windows : mkcert -uninstall (dit, pas automatique -
#     on ne retire pas une confiance dans le dos de l'utilisateur).
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  NARCHI - 9 RETIRER HTTPS LOCAL (retour a http://localhost:8080 seul)" -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Droits administrateur requis (retrait pare-feu) : fenetre elevee..." -ForegroundColor Yellow
    $argList = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $p = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs -Wait -PassThru
    exit $p.ExitCode
}

$enabledDir = Join-Path $root "infra\tls\enabled"
$bloc = Join-Path $enabledDir "https-8443.conf"
if (Test-Path $bloc) {
    Remove-Item $bloc -Force
    Write-Host "[OK] Bloc nginx 8443 retire (infra\\tls\\enabled\\ est vide)" -ForegroundColor Green
} else {
    Write-Host "[..] Bloc nginx 8443 deja absent - rien a retirer de ce cote" -ForegroundColor DarkGray
}

$ruleName = "NARCHI HTTPS local (8443)"
$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($rule) {
    $rule | Remove-NetFirewallRule
    Write-Host "[OK] Regle de pare-feu 8443 retiree" -ForegroundColor Green
} else {
    Write-Host "[..] Regle de pare-feu deja absente" -ForegroundColor DarkGray
}

Write-Host "Relance du conteneur frontend..."
& docker compose --env-file (Join-Path $root ".env") up -d --no-deps frontend | Out-Host
if ($LASTEXITCODE -ne 0) { throw "docker compose a echoue (code $LASTEXITCODE)." }

# Preuve, pas promesse : 8080 DOIT repondre, 8443 NE DOIT PLUS repondre.
$ok8080 = $false
foreach ($essai in 1..10) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8080/" -UseBasicParsing -TimeoutSec 15
        if ($r.StatusCode -eq 200) { $ok8080 = $true; break }
    } catch {}
}
if (-not $ok8080) {
    Write-Host "[ERREUR] http://localhost:8080 ne repond plus apres 20 s - indesirable." -ForegroundColor Red
    Write-Host "Relancez 1_DEMARRER_NARCHI.bat puis re-verifiez." -ForegroundColor Red
    exit 2
}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
$encore8443 = $false
try {
    $r = Invoke-WebRequest -Uri "https://localhost:8443/" -UseBasicParsing -TimeoutSec 8
    if ($r.StatusCode -eq 200) { $encore8443 = $true }
} catch {}
if ($encore8443) {
    Write-Host "[ERREUR] https://localhost:8443 repond ENCORE - le retrait n'est pas pris en compte." -ForegroundColor Red
    exit 3
}

Write-Host ""
Write-Host "[OK] Retrait mesure : 8080 HTTP repond, 8443 ne repond plus." -ForegroundColor Green
Write-Host ""
Write-Host "CONSERVE (dit honnetement) :" -ForegroundColor Yellow
Write-Host "  - les certificats dans infra\\tls\\certs\\ (re-activation = 8_ACTIVER_HTTPS_LOCAL.bat)" -ForegroundColor Yellow
Write-Host "  - la CA mkcert installee dans Windows. Pour la retirer aussi :" -ForegroundColor Yellow
Write-Host "      ouvrez PowerShell en administrateur puis :  mkcert -uninstall" -ForegroundColor Yellow
Write-Host "    (manuel expres : on ne retire pas une confiance installee sans vous)" -ForegroundColor Yellow
exit 0
