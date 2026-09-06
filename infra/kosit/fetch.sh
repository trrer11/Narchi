#!/usr/bin/env bash
# Download KoSIT JAR + XRechnung 3.0.2 config. SHA-256 must match pins.env.
set -euo pipefail
PINS="$(cd "$(dirname "$0")" && pwd)/pins.env"
# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
. "$PINS"
set +a
CACHE="${KOSIT_CACHE:-/work/cache}"
mkdir -p "$CACHE"
recuperer() {
  local url="$1" sha="$2" dest="$3"
  if [ ! -f "$dest" ]; then
    echo ">> download $url"
    curl -fsSL --max-time 600 -o "$dest" "$url"
  fi
  local mesure
  mesure="$(sha256sum "$dest" | awk '{print $1}')"
  if [ "$mesure" != "$sha" ]; then
    echo "SHA mismatch $dest got $mesure want $sha" >&2
    rm -f "$dest"
    exit 1
  fi
  echo "   sha ok $sha"
}
recuperer "$VALIDATOR_URL" "$VALIDATOR_SHA256" "$CACHE/validator-1.6.2.jar"
recuperer "$CONFIG_URL" "$CONFIG_SHA256" "$CACHE/xrechnung-3.0.2-cfg-2026-01-31.zip"
rm -rf "$CACHE/cfg" && mkdir -p "$CACHE/cfg"
unzip -qo "$CACHE/xrechnung-3.0.2-cfg-2026-01-31.zip" -d "$CACHE/cfg"
test -f "$CACHE/cfg/scenarios.xml"
