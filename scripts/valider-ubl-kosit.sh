#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# §130 - Revalidation OFFICIELLE des factures UBL 2.1 de Narchi (syntaxe Peppol)
#
# Ce script rejoue la preuve du 16/08/2026 : il genere les echantillons UBL
# depuis NOTRE code (meme modele metier §114 que le CII et l'hybride §129) et
# les soumet au logiciel de validation publie par l'Etat allemand :
#   - KoSIT Validator v1.6.2 (JAR autonome, empreinte epinglee ci-dessous)
#   - configuration XRechnung 3.0.2 parue le 31/01/2026 (empreinte epinglee)
#
# Le validateur possede DEUX scenarios UBL (cf. scenarios.xml) :
#   * EN16931 XRechnung (UBL Invoice)  -> profil allemand secteur public
#   * EN16931 (UBL Invoice)            -> profil europeen generique
# Les DEUX doivent rendre « ACCEPTABLE ».
#
# Usage :   bash scripts/valider-ubl-kosit.sh
# Attendu : « Validation successful! » + ACCEPTABLE pour chaque XML,
#           code de sortie 0. Tout autre verdict = code 1 + cause affichee.
#
# Prerequis (machines de dev / CI Linux) : java (JRE 11+), unzip, curl,
# sha256sum, python avec les deps backend installees (pytest incluse, car les
# echantillons viennent de la fixture des tests = source de verite unique).
#
# DIT HONNETEMENT : rejouable en LOCAL et en CI Linux. Ceci valide la SYNTAXE
# UBL (le payload du reseau Peppol), PAS l'envoi reel sur Peppol — l'envoi
# exige un Access Point et des identifiants (jalon « Versand », DIFFERE).
# ------------------------------------------------------------------------------
set -euo pipefail

VALIDATOR_URL="https://github.com/itplr-kosit/validator/releases/download/v1.6.2/validator-1.6.2-standalone.jar"
VALIDATOR_SHA256="244978514ad48f67c7573acfffc8f4fd73d81feda6f276710033f9913579857e"
CONFIG_URL="https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-01-31/xrechnung-3.0.2-validator-configuration-2026-01-31.zip"
CONFIG_SHA256="6a5a5911a421b25fbc423f62f93f894df7b236f5d73ca4f84bb222a945082704"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${KOSIT_CACHE:-${TMPDIR:-/tmp}/narchi-kosit}"
OUT="${KOSIT_OUT:-${TMPDIR:-/tmp}/narchi-ubl-samples}"
PY="${PYTHON:-python}"

mourir() { echo "EChec: $*" >&2; exit 1; }

for outil in java curl unzip sha256sum "$PY"; do
  command -v "$outil" >/dev/null 2>&1 || mourir "outil manquant: $outil"
done

mkdir -p "$CACHE" "$OUT"

# --- 1) Outillage officiel epingle (HTTPS + SHA-256 verifie a chaque fois) ----
echo "== 1/3 Outillage officiel (epingles v1.6.2 + config 3.0.2 du 31/01/2026) =="
recuperer() {
  local url="$1" sha="$2" dest="$3"
  if [ ! -f "$dest" ]; then
    echo ">> telechargement: $url"
    curl -fsSL --max-time 600 -o "$dest" "$url" || mourir "telechargement impossible: $url"
  fi
  local mesure
  mesure="$(sha256sum "$dest" | awk '{print $1}')"
  [ "$mesure" = "$sha" ] || mourir "empreinte differente pour $dest: $mesure (attendu $sha) - artefact modifie, ON S'ARRETE la."
  echo "   empreinte OK"
}
recuperer "$VALIDATOR_URL" "$VALIDATOR_SHA256" "$CACHE/validator-1.6.2.jar"
recuperer "$CONFIG_URL" "$CONFIG_SHA256" "$CACHE/xrechnung-3.0.2-cfg-2026-01-31.zip"
rm -rf "$CACHE/cfg" && mkdir -p "$CACHE/cfg"
unzip -qo "$CACHE/xrechnung-3.0.2-cfg-2026-01-31.zip" -d "$CACHE/cfg"
[ -f "$CACHE/cfg/scenarios.xml" ] || mourir "scenarios.xml absent de la configuration"

# --- 2) Echantillons UBL generes depuis NOTRE code (fixture = source) ---------
echo "== 2/3 Generation des echantillons UBL par le service reel =="
PYTHONPATH="$REPO/backend:$REPO/backend/tests" "$PY" - "$OUT" <<'PYEOF'
import sys
from pathlib import Path

out = Path(sys.argv[1])
from test_xrechnung import facture_ok
from app.services.ubl import construire_ubl

for profil in ("xrechnung", "en16931"):
    (out / f"facture-{profil}-ubl.xml").write_text(
        construire_ubl(facture_ok(), profil), encoding="utf-8"
    )
print("   echantillons UBL ecrits dans", out)
PYEOF

# --- 3) Verdict officiel (scenarios UBL du validateur KoSIT) -----------------
echo "== 3/3 Verdict du validateur officiel (scenarios UBL) =="
set +e
VERDICT="$(java -jar "$CACHE/validator-1.6.2.jar" -s "$CACHE/cfg/scenarios.xml" -r "$CACHE/cfg" \
  -p "$OUT/facture-xrechnung-ubl.xml" "$OUT/facture-en16931-ubl.xml" 2>&1)"
RC=$?
set -e
echo "$VERDICT" | grep -E "ACCEPTABLE|REJECT|Acceptable:|Validation" | head -10
[ $RC -eq 0 ] || mourir "le validateur a renvoye un code $RC"
echo "$VERDICT" | grep -q "Validation successful!" \
  || mourir "verdict non conforme - lire la sortie ci-dessus"
echo "$VERDICT" | grep -q "Rejected:  0" \
  || mourir "au moins un document rejete - lire la sortie ci-dessus"

echo ""
echo "OK - les DEUX profils UBL generes par Narchi sont ACCEPTABLES selon le"
echo "validateur officiel KoSIT v1.6.2 (XRechnung 3.0.2, 31/01/2026)."
echo "Rappel : ceci valide la SYNTAXE UBL (payload Peppol), pas l'ENVOI Peppol."
