#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# §129 - Revalidation OFFICIELLE des factures hybrides PDF/A-3 + factur-x.xml
# (ZUGFeRD / Factur-X) de Narchi.
#
# Ce script rejoue la preuve du 16/08/2026 : il genere un PDF hybride depuis
# NOTRE code (le meme constructeur CII §114 que KoSIT valide deja, puis le
# nouveau service §129 qui embarque le XML dans un PDF/A-3) et le soumet au
# validateur de la communaute ZUGFeRD/Factur-X : Mustang.
#
#   - Mustang-CLI v2.25.0 (Apache-2.0 - PAS AGPL, doctrine §114 respectee),
#     empreinte SHA-256 epinglee ci-dessous.
#   - Mustang execute veraPDF (conformite PDF/A-3 ISO 19005-3) + Schematron
#     (conformite EN 16931 de l'XML embarque) : UN seul verdict recouvre les
#     deux exigences de la facture hybride.
#
# Usage :   bash scripts/valider-zugferd-mustang.sh
# Attendu : « Parsed PDF:valid XML:valid » + « isCompliant=true »,
#           code de sortie 0. Tout autre verdict = code 1 + cause affichee.
#
# Prerequis (machines de dev / CI Linux) : java (JRE 11+), curl, sha256sum,
# python avec les deps backend (reportlab + pytest + pillow, car l'echantillon
# vient de la fixture des tests = source de verite unique, et le logo RGBA
# est construit a la volee §150).
#
# DIT HONNETEMENT : rejouable en LOCAL et en CI Linux. Aucune pipeline
# GitHub Actions n'a encore ete executee depuis ce depot pour CE script
# (meme etat que le script KoSIT §123/§128).
# ------------------------------------------------------------------------------
set -euo pipefail

MUSTANG_URL="https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.25.0/Mustang-CLI-2.25.0.jar"
MUSTANG_SHA256="d68b9fd6a9948a0964b7c93ed06b7e903a6dbafcd0df581e992e3178bf016701"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${MUSTANG_CACHE:-${TMPDIR:-/tmp}/narchi-mustang}"
OUT="${MUSTANG_OUT:-${TMPDIR:-/tmp}/narchi-zugferd-samples}"
PY="${PYTHON:-python}"

mourir() { echo "EChec: $*" >&2; exit 1; }

for outil in java curl sha256sum "$PY"; do
  command -v "$outil" >/dev/null 2>&1 || mourir "outil manquant: $outil"
done

mkdir -p "$CACHE" "$OUT"

# --- 1) Mustang-CLI epingle (HTTPS + SHA-256 verifie a chaque fois) -----------
echo "== 1/3 Mustang-CLI v2.25.0 (epingle, Apache-2.0) =="
if [ ! -f "$CACHE/Mustang-CLI-2.25.0.jar" ]; then
  echo ">> telechargement: $MUSTANG_URL"
  curl -fsSL --max-time 600 -o "$CACHE/Mustang-CLI-2.25.0.jar" "$MUSTANG_URL" \
    || mourir "telechargement impossible: $MUSTANG_URL"
fi
mesure="$(sha256sum "$CACHE/Mustang-CLI-2.25.0.jar" | awk '{print $1}')"
[ "$mesure" = "$MUSTANG_SHA256" ] || mourir "empreinte differente: $mesure (attendu $MUSTANG_SHA256) - artefact modifie, ON S'ARRETE la."
echo "   empreinte OK"

# --- 2) PDF hybrides generes depuis NOTRE code (fixture = source de verite) ---
# §150 — DEUX echantillons : sans logo ET avec logo RGBA (transparence) — le
# gabarit professionnel ET le logo doivent rester PDF/A-3 conformes.
echo "== 2/3 Generation des PDF hybrides (sans logo + avec logo) par le service reel =="
PYTHONPATH="$REPO/backend:$REPO/backend/tests" "$PY" - "$OUT" <<'PYEOF'
import base64
import sys
from pathlib import Path

out = Path(sys.argv[1])
from test_xrechnung import facture_ok
from app.services.xrechnung import construire_cii
from app.services.zugferd_pdf import generer_pdf_zugferd, extraire_xml

# Logo RGBA (transparence) construit a la volee — le cas reel d'un logo de bureau.
from PIL import Image, ImageDraw
import io
img = Image.new("RGBA", (400, 160), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([10, 10, 390, 150], radius=20, fill=(30, 41, 59, 255))
d.ellipse([20, 20, 70, 70], fill=(245, 158, 11, 255))
buf = io.BytesIO()
img.save(buf, "PNG")
logo_b64 = base64.b64encode(buf.getvalue()).decode()

fac = facture_ok()
xml = construire_cii(fac, "en16931")  # profil ZUGFeRD/Factur-X, PAS XRechnung
for suffixe, kwargs in (
    ("facture-zugferd.pdf", {}),
    ("facture-zugferd-logo.pdf", {"logo_b64": logo_b64, "office_name": "Architekturbüro Muster"}),
):
    pdf = generer_pdf_zugferd(fac, xml, **kwargs)
    (out / suffixe).write_bytes(pdf)
    # Garde-honnetete : le XML embarque doit etre extractible a l'octet pres.
    assert extraire_xml(pdf) == xml, f"{suffixe}: XML embarque != XML source"
    print(f"   {suffixe} ecrit, round-trip XML verifie")
PYEOF

# --- 3) Verdict Mustang (veraPDF + Schematron) sur LES DEUX PDF ---------------
echo "== 3/3 Verdict Mustang (PDF/A-3 + EN 16931) =="
for echantillon in facture-zugferd.pdf facture-zugferd-logo.pdf; do
  echo "-- ${echantillon} --"
  set +e
  VERDICT="$(java -Xmx1G -Dfile.encoding=UTF-8 -jar "$CACHE/Mustang-CLI-2.25.0.jar" \
    --no-notices --action validate --source "$OUT/$echantillon" 2>&1)"
  RC=$?
  set -e
  echo "$VERDICT" | tail -8
  [ $RC -eq 0 ] || mourir "Mustang a renvoye un code $RC ($echantillon)"
  echo "$VERDICT" | grep -q "Parsed PDF:valid XML:valid" \
    || mourir "PDF ou XML invalide ($echantillon) - lire la sortie ci-dessus"
  echo "$VERDICT" | grep -q "isCompliant=true" \
    || mourir "PDF/A-3 non conforme ($echantillon) - veraPDF"
done

echo ""
echo "OK - les DEUX PDF hybrides de Narchi (sans logo + avec logo RGBA) sont"
echo "PDF/A-3b CONFORMES (veraPDF, ISO 19005-3) et l'XML embarque VALIDE EN 16931"
echo "(Schematron) selon Mustang v2.25.0."
