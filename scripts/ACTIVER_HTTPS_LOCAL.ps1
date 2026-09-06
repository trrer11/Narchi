# etape 119 - HTTPS LOCAL : fait confiance a un certificat LOCAL pour que le
# telephone accepte Narchi (photo par appareil photo, mode hors-ligne PWA,
# chiffrement - tout cela est bloque sur http://192.168.x.x par les
# navigateurs, et c'est normal).
#
# Ce que fait ce script, dans l'ordre, et VERIFIE a la fin :
#   1) droits administrateur (relais automatique dans une fenetre elevee),
#   2) mkcert trouve ou installe (winget d'abord ; sinon telechargement
#      officiel EPINGLE par empreinte SHA-256 - un doute = refus franc),
#   3) mkcert -install : l'autorite de certification (CA) LOCALE est passee
#      dans le magasin de certificats Windows de confiance,
#   4) certificat genere pour localhost + 127.0.0.1 + ::1 + les IP du PC,
#   5) bloc HTTPS 8443 d'nginx active (UNE copie de fichier, rien d'autre
#      ne change : le 8080 HTTP historique vit exactement pareil),
#   6) pare-feu Windows : entree 8443 en reseau PRIVE/DOM main uniquement
#      (jamais Public - du Wi-Fi d'hotel, on ne sert pas votre bureau),
#   7) conteneur frontend relance, puis resultat PROUVE par de vraies
#      requetes (pas promis : mesure).
#
# Limites DITES (doc complete : docs\\HTTPS_LOCAL.md) :
#   - l'IP du PC peut changer (box en automatique) -> relancez ce script ;
#     le telephone garde alors sa confiance (la CA ne change pas) ;
#   - mkcert -install rend la CA de confiance pour TOUTE cette machine -
#     c'est le principe meme d'un certificat local, assume et documente ;
#     retrait possible plus tard : 9_RETIRER_HTTPS_LOCAL.bat puis
#     "mkcert -uninstall" si vous voulez aussi retirer la CA.
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host "  NARCHI - 8 ACTIVER HTTPS LOCAL (etape 4 : usage telephone)" -ForegroundColor Green
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Droits administrateur ------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Droits administrateur requis (installation de la CA + pare-feu)." -ForegroundColor Yellow
    Write-Host "Relais dans une fenetre elevee : acceptez la demande de Windows." -ForegroundColor Yellow
    $argList = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $p = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs -Wait -PassThru
    exit $p.ExitCode
}

# --- 2. mkcert present (sinon installation verifiee) --------------------------
$toolsDir = Join-Path $root "tools"
$mkcert = $null
$cmd = Get-Command mkcert -ErrorAction SilentlyContinue
if ($cmd) { $mkcert = $cmd.Source }
$installeLocal = Join-Path $toolsDir "mkcert.exe"
if (-not $mkcert -and (Test-Path $installeLocal)) { $mkcert = $installeLocal }

if (-not $mkcert -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "mkcert absent : tentative via winget (paquet officiel FiloSottile.mkcert)..."
    & winget install --id FiloSottile.mkcert -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
    $cmd = Get-Command mkcert -ErrorAction SilentlyContinue
    if ($cmd) { $mkcert = $cmd.Source }
}

if (-not $mkcert) {
    # Dernier chemin : telechargement EPINGLE. URL annoncee dans les notes de
    # version officielles v1.4.4 ; empreinte SHA-256 mesuree le 12/08/2026 sur
    # le binaire officiel (l'upstream ne publie pas de somme - dit dans la doc).
    # TOUT ecart = suppression immediate, jamais d'execution non verifiee.
    $url = "https://dl.filippo.io/mkcert/v1.4.4?for=windows/amd64"
    $attendu = "d2660b50a9ed59eada480750561c96abc2ed4c9a38c6a24d93e30e0977631398"
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    $dest = Join-Path $toolsDir "mkcert.exe"
    Write-Host "Telechargement mkcert v1.4.4 (source officielle) : $url"
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    $reel = (Get-FileHash -Algorithm SHA256 $dest).Hash.ToLowerInvariant()
    if ($reel -ne $attendu) {
        Remove-Item $dest -Force -ErrorAction SilentlyContinue
        throw "Empreinte SHA-256 INATTENDUE ($reel). Binaire refuse et supprime. Installez mkcert manuellement puis relancez ce fichier."
    }
    Write-Host "[OK] Empreinte SHA-256 verifiee : $reel" -ForegroundColor Green
    $mkcert = $dest
}
Write-Host "[OK] mkcert : $mkcert" -ForegroundColor Green

# --- 3. CA locale dans le magasin de confiance Windows ------------------------
& $mkcert -install | Out-Host
if ($LASTEXITCODE -ne 0) { throw "mkcert -install a echoue (code $LASTEXITCODE)." }
$caroot = (& $mkcert -CAROOT).Trim()
$rootCa = Join-Path $caroot "rootCA.pem"
if (-not (Test-Path $rootCa)) { throw "rootCA.pem introuvable dans $caroot - mkcert -install s'est-il bien termine ?" }
Write-Host "[OK] CA locale installee (CAROOT : $caroot)" -ForegroundColor Green

# --- 4. Certificat pour localhost + IP locales du PC --------------------------
$certsDir = Join-Path $root "infra\tls\certs"
New-Item -ItemType Directory -Force -Path $certsDir | Out-Null
$certPem = Join-Path $certsDir "narchi-local.pem"
$keyPem  = Join-Path $certsDir "narchi-local-key.pem"
$caPourTel = Join-Path $certsDir "narchi-CA-POUR-TELEPHONE.pem"
Copy-Item $rootCa $caPourTel -Force

# Toutes les IP v4 utiles (interfaces actives, hors boucle et hors 169.254.*).
# Les bridges Docker/WSL peuvent etre inclus : des SAN en trop ne genent rien.
$lanIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -notmatch "^169\.254\." -and -not $_.IPAddress.StartsWith("127.") } |
    ForEach-Object { $_.IPAddress } | Sort-Object -Unique)
if ($lanIps.Count -gt 0) {
    Write-Host "IP detectees pour le certificat : $($lanIps -join ', ')"
} else {
    Write-Host "[AVERTISSEMENT] aucune IP locale detectee : certificat localhost seul" -ForegroundColor Yellow
}
$hotes = @("localhost", "127.0.0.1", "::1") + $lanIps
& $mkcert -cert-file $certPem -key-file $keyPem @hotes | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Generation du certificat impossible (code $LASTEXITCODE)." }
if (-not (Test-Path $certPem) -or -not (Test-Path $keyPem)) { throw "Certificat ou cle non ecrits malgre un succes apparent - refus franc." }
Write-Host "[OK] Certificat ecrit : $certPem" -ForegroundColor Green

# --- 5. Activation du bloc nginx 8443 (UNE copie de fichier) ------------------
$enabledDir = Join-Path $root "infra\tls\enabled"
New-Item -ItemType Directory -Force -Path $enabledDir | Out-Null
Copy-Item (Join-Path $root "infra\tls\https-8443.conf") (Join-Path $enabledDir "https-8443.conf") -Force
Write-Host "[OK] Bloc HTTPS copie dans infra\\tls\\enabled\\ (8080 inchange)" -ForegroundColor Green

# --- 6. Pare-feu : reseau PRIVE/DOM main seulement ----------------------------
$ruleName = "NARCHI HTTPS local (8443)"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private,Domain | Out-Null
Write-Host "[OK] Pare-feu : port 8443 ouvert (reseau prive/domaine, jamais public)" -ForegroundColor Green

# --- 7. Relance frontend + preuve reelle --------------------------------------
Write-Host ""
Write-Host "Relance du conteneur frontend (recreation si montages/ports nouveaux)..."
& docker compose --env-file (Join-Path $root ".env") up -d --no-deps frontend | Out-Host
if ($LASTEXITCODE -ne 0) { throw "docker compose a echoue (code $LASTEXITCODE)." }

try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
function Test-NarchiHttps([string]$url) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

$okLocal = $false
foreach ($essai in 1..10) {
    Start-Sleep -Seconds 2
    if (Test-NarchiHttps "https://localhost:8443/") { $okLocal = $true; break }
}
if (-not $okLocal) {
    Write-Host "[ERREUR] https://localhost:8443 ne repond pas en 200 apres 20 s." -ForegroundColor Red
    Write-Host "Cause la plus probable : l'image frontend date d'avant l'etape 4." -ForegroundColor Red
    Write-Host "Remede : lancez 3_REPARER_NARCHI_SANS_PERTE.bat, puis relancez ce fichier." -ForegroundColor Red
    exit 2
}
Write-Host "[OK] https://localhost:8443 repond (certificat de confiance, cote PC)" -ForegroundColor Green

$ipsOk = @()
foreach ($ip in $lanIps) {
    if (Test-NarchiHttps "https://${ip}:8443/") {
        $ipsOk += $ip
        Write-Host "[OK] https://${ip}:8443 repond et est de CONFIANCE (SAN couvert)" -ForegroundColor Green
    } else {
        Write-Host "[AVERTISSEMENT] https://${ip}:8443 ne repond pas (souvent un bridge Docker - sans importance si l'IP de la box repond)" -ForegroundColor Yellow
    }
}
if ($lanIps.Count -gt 0 -and $ipsOk.Count -eq 0) {
    Write-Host "[ERREUR] Aucune IP locale ne repond en HTTPS : le telephone ne pourra pas joindre le PC." -ForegroundColor Red
    Write-Host "Verifiez que Docker Desktop tourne et relancez ce fichier." -ForegroundColor Red
    exit 3
}

Write-Host ""
Write-Host "=========================== HTTPS LOCAL ACTIF ============================" -ForegroundColor Green
Write-Host "  PC        : https://localhost:8443  (le 8080 HTTP marche comme avant)"
foreach ($ip in $ipsOk) { Write-Host "  Telephone : https://${ip}:8443" }
Write-Host ""
Write-Host "  DERNIER GESTE, MANUEL (une fois par telephone) :" -ForegroundColor Yellow
Write-Host "  installez ce certificat de confiance sur le telephone :" -ForegroundColor Yellow
Write-Host "     $caPourTel" -ForegroundColor Yellow
Write-Host "     Android : Parametres > Securite > Installer un certificat > CA" -ForegroundColor Yellow
Write-Host "     iPhone  : envoyez le .pem sur le telephone, ouvrez-le, puis" -ForegroundColor Yellow
Write-Host "               Reglages > General > VPN et gestion appareil > install," -ForegroundColor Yellow
Write-Host "               PUIS General > Informations > Reglages des certificats > activer" -ForegroundColor Yellow
Write-Host "  Pas a pas illustre et limites honnetes : docs\\HTTPS_LOCAL.md" -ForegroundColor Cyan
exit 0
