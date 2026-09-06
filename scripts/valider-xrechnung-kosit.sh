#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# section 123 - Revalidation OFFICIELLE des factures XML de Narchi (XRechnung)
#
# Ce script rejoue la preuve du 13/08/2026 : il genere les echantillons depuis
# NOTRE code (jamais de XML ecrit a la main dans ce depot hors fixtures dorees)
# et les soumet au logiciel de validation publie par l'Etat allemand :
#   - KoSIT Validator v1.6.2 (JAR autonome, empreinte epinglee ci-dessous)
#   - configuration XRechnung 3.0.2 parue le 31/01/2026 (empreinte epinglee)
#
# Usage :   bash scripts/valider-xrechnung-kosit.sh
# Attendu : "Validation successful!" + verdict ACCEPTABLE pour chaque XML,
#           code de sortie 0. Tout autre verdict = code 1 + cause affichee.
#
# Prerequis (machines de dev / CI Linux) : java (JRE 11+), unzip, curl,
# sha256sum, python avec les deps backend installees (pytest incluse, car les
# echantillons viennent de la fixture des tests = source de verite unique).
#
# DIT HONNETEMENT : ce script est rejouable en LOCAL et en CI Linux. Aucune
# pipeline GitHub Actions n'a encore ete executee depuis ce depot - le jalon
# "validation en CI hebergee" n'est donc pas promis, il est PREPARE par ce
# script. Windows client : lancer dans Git Bash/WSL ou sur la VM.
# ------------------------------------------------------------------------------
set -euo pipefail

VALIDATOR_URL="https://github.com/itplr-kosit/validator/releases/download/v1.6.2/validator-1.6.2-standalone.jar"
VALIDATOR_SHA256="244978514ad48f67c7573acfffc8f4fd73d81feda6f276710033f9913579857e"
CONFIG_URL="https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-01-31/xrechnung-3.0.2-validator-configuration-2026-01-31.zip"
CONFIG_SHA256="6a5a5911a421b25fbc423f62f93f894df7b236f5d73ca4f84bb222a945082704"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${KOSIT_CACHE:-${TMPDIR:-/tmp}/narchi-kosit}"
OUT="${KOSIT_OUT:-${TMPDIR:-/tmp}/narchi-xrechnung-samples}"
PY="${PYTHON:-python}"

mourir() { echo "EChec: $*" >&2; exit 1; }

for outil in java curl unzip sha256sum "$PY"; do
  command -v "$outil" >/dev/null 2>&1 || mourir "outil manquant: $outil"
done

mkdir -p "$CACHE" "$OUT"

# --- 1) Telechargement epingle (HTTPS + SHA-256 verifie a chaque fois) -------
recuperer() {
  local url="$1" sha="$2" dest="$3"
  if [ ! -f "$dest" ]; then
    echo ">> telechargement: $url"
    curl -fsSL --max-time 600 -o "$dest" "$url" || mourir "telechargement impossible: $url"
  fi
  local mesure
  mesure="$(sha256sum "$dest" | awk '{print $1}')"
  [ "$mesure" = "$sha" ] || mourir "empreinte differente pour $dest: $mesure (attendu $sha) - artefact modifie ou erreur de copie, ON S'ARRETE la."
  echo "   empreinte OK ($sha)"
}

echo "== 1/4 Outillage officiel (epingles v1.6.2 + config 3.0.2 du 31/01/2026) =="
recuperer "$VALIDATOR_URL" "$VALIDATOR_SHA256" "$CACHE/validator-1.6.2.jar"
recuperer "$CONFIG_URL" "$CONFIG_SHA256" "$CACHE/xrechnung-3.0.2-cfg-2026-01-31.zip"
rm -rf "$CACHE/cfg" && mkdir -p "$CACHE/cfg"
unzip -qo "$CACHE/xrechnung-3.0.2-cfg-2026-01-31.zip" -d "$CACHE/cfg"
[ -f "$CACHE/cfg/scenarios.xml" ] || mourir "scenarios.xml absent de la configuration"

# --- 2) Echantillons generes depuis NOTRE code (fixture = source de verite) --
echo "== 2/4 Generation des echantillons par le service reel =="
PYTHONPATH="$REPO/backend:$REPO/backend/tests" "$PY" - "$OUT" <<'PYEOF'
import sys
from pathlib import Path

out = Path(sys.argv[1])
from test_xrechnung import facture_ok  # fixture reelle, dates fixes = deterministe
from app.services.xrechnung import construire_cii, valider

for profil in ("xrechnung", "en16931"):
    f = facture_ok()
    viol = valider(f, profil)
    assert not viol, viol
    (out / f"facture-{profil}.xml").write_text(construire_cii(f, profil), encoding="utf-8")
print("   echantillons ecrits dans", out)
PYEOF

# --- 3) Garde-honnetete : les fixtures dorees doivent correspondre -----------
echo "== 3/4 Comparaison aux fixtures dorees (preuve du 13/08/2026) =="
for profil in xrechnung en16931; do
  fixture="$REPO/backend/tests/fixtures/xrechnung_kosit/facture-${profil}-kosit-acceptee.xml"
  if [ -f "$fixture" ]; then
    if ! cmp -s "$OUT/facture-${profil}.xml" "$fixture"; then
      echo "   ATTENTION: facture-${profil}.xml differe de la fixture acceptee -"
      echo "   si le verdict ci-dessous est ACCEPTABLE, rafraichir la fixture"
      echo "   (voir backend/tests/fixtures/xrechnung_kosit/README.md)."
    else
      echo "   facture-${profil}.xml : octets identiques a la preuve archivee"
    fi
  fi
done

# --- 4) Verdict officiel ------------------------------------------------------
echo "== 4/4 Verdict du validateur officiel =="
RAPPORTS="$CACHE/rapports"
rm -rf "$RAPPORTS" && mkdir -p "$RAPPORTS"
set +e
VERDICT="$(java -jar "$CACHE/validator-1.6.2.jar" -s "$CACHE/cfg/scenarios.xml" -r "$CACHE/cfg" \
  -o "$RAPPORTS" "$OUT/facture-xrechnung.xml" "$OUT/facture-en16931.xml" 2>&1)"
RC=$?
set -e
echo "$VERDICT"
[ $RC -eq 0 ] || mourir "le validateur a renvoye un code $RC"
echo "$VERDICT" | grep -q "Validation successful!" \
  || mourir "verdict non conforme - lire les rapports dans $RAPPORTS"
echo "$VERDICT" | grep -q "Rejected:  0" \
  || mourir "au moins un document rejete - lire les rapports dans $RAPPORTS"

echo ""
echo "OK - les DEUX profils generes par Narchi sont ACCEPTABLES selon le"
echo "validateur officiel KoSIT v1.6.2 (XRechnung 3.0.2, 31/01/2026)."
echo "Rapports detailles: $RAPPORTS"
