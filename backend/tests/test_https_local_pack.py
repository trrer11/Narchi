"""§119 — Garde du pack HTTPS local (étape 4 du plan de synchro).

Le pack tient ENSEMBLE par des chemins partagés entre 6 fichiers : si l'un
dérive (chemin de certificat, port, nom de script), l'activation client
casse SILENCIEUSEMENT. Ces tests figent le contrat :

- nginx.conf : 8080 (historique) via l'include commun, 8443 via glob
  INERTE quand le dossier est vide ;
- nginx-common.inc : corps serveur unique, SANS directive listen (pureté
  de contexte — un listen ici serait répété dans les DEUX blocs) ;
- infra/tls/https-8443.conf : bloc 8443 statique référençant EXACTEMENT
  les chemins montés par docker-compose.yml ;
- Dockerfile frontend : l'include commun est bien copié dans l'image ;
- scripts Windows : existent, portent l'empreinte SHA-256 épinglée de
  mkcert (téléchargement vérifié, jamais à l'aveugle) ;
- .gitignore : les vrais certificats (clé privée !) ne peuvent pas
  entrer dans git ;
- README : le fichier à double-cliquer est cité (§53 : pas de promesse
  sur un fichier absent).

Les tests d'encodage ASCII/CRLF des scripts restent au §52 (auto-découverte).
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

NGINX = (ROOT / "frontend" / "nginx.conf").read_text(encoding="utf-8")
INC = (ROOT / "frontend" / "nginx-common.inc").read_text(encoding="utf-8")
TEMPLATE = (ROOT / "infra" / "tls" / "https-8443.conf").read_text(encoding="utf-8")
COMPOSE = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
DOCKERFILE = (ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
GITIGNORE = (ROOT / ".gitignore").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")


def test_nginx_keeps_historic_8080_through_shared_include():
    # Le bloc 8080 historique doit exister tel quel, contenu délégué.
    assert re.search(r"(?m)^server \{$", NGINX), "bloc server principal absent"
    assert "listen 8080;" in NGINX
    assert "include /etc/nginx/conf.d/narchi-common-locations.inc;" in NGINX


def test_nginx_tls_include_is_glob_and_top_level():
    # L'include §119 doit être au NIVEAU http (indent 0) : un include de
    # server{} dans un server{} est une erreur nginx — et un glob vide
    # est toléré (installation sans l'étape 4 = comportement inchangé).
    lignes = [l for l in NGINX.splitlines() if "tls-enabled" in l and "include" in l]
    assert len(lignes) == 1, f"include TLS {'manquant' if not lignes else 'en double'} : {lignes}"
    assert lignes[0] == "include /etc/nginx/tls-enabled/*.conf;", (
        f"l'include TLS doit être au niveau http, sans indentation : {lignes[0]!r}"
    )
    assert lignes[0].endswith("*.conf;"), "glob requis : un dossier VIDE ne doit pas casser nginx"


def test_common_include_has_no_listen_directive():
    # Pureté de contexte : l'include commun est inclus dans DEUX server{} —
    # un listen ici dupliquerait les écoutes et échouerait au démarrage.
    assert not re.search(r"(?m)^\s*listen\s", INC), "directive listen interdite dans l'include commun"
    assert not re.search(r"(?m)^\s*server_name\s", INC), "server_name interdit dans l'include commun"
    # Et il doit porter le vrai contenu (sinon le partage est un leurre).
    assert "location /api/" in INC
    assert "Content-Security-Policy" in INC
    assert INC.count("location") >= 10, f"corps commun anormalement pauvre : {INC.count('location')} locations"


def test_template_8443_references_exactly_compose_mounts():
    assert "listen 8443 ssl;" in TEMPLATE
    assert "ssl_certificate     /etc/nginx/tls/narchi-local.pem;" in TEMPLATE
    assert "ssl_certificate_key /etc/nginx/tls/narchi-local-key.pem;" in TEMPLATE
    assert "include /etc/nginx/conf.d/narchi-common-locations.inc;" in TEMPLATE
    assert "ssl_protocols TLSv1.2 TLSv1.3;" in TEMPLATE
    # Le compose doit monter EXACTEMENT ces chemins (ro = nginx ne peut
    # pas réécrire ses certificats).
    assert "./infra/tls/certs:/etc/nginx/tls:ro" in COMPOSE
    assert "./infra/tls/enabled:/etc/nginx/tls-enabled:ro" in COMPOSE
    assert re.search(r'NARCHI_HTTPS_LOCAL_PORT:-8443', COMPOSE), "port 8443 non publié par le compose"


def test_dockerfile_ships_common_include():
    assert "COPY nginx-common.inc /etc/nginx/conf.d/narchi-common-locations.inc" in DOCKERFILE


def test_operator_scripts_exist_and_pin_mkcert_hash():
    bat_activer = ROOT / "8_ACTIVER_HTTPS_LOCAL.bat"
    bat_retirer = ROOT / "9_RETIRER_HTTPS_LOCAL.bat"
    ps_activer = ROOT / "scripts" / "ACTIVER_HTTPS_LOCAL.ps1"
    ps_retirer = ROOT / "scripts" / "RETIRER_HTTPS_LOCAL.ps1"
    for f in (bat_activer, bat_retirer, ps_activer, ps_retirer):
        assert f.is_file(), f"script opérateur manquant : {f}"
    texte = ps_activer.read_text(encoding="ascii")
    # Binaire téléchargé JAMAIS exécuté à l'aveugle : empreinte épinglée
    # (mesurée le 12/08/2026 sur l'asset officiel mkcert v1.4.4 windows/amd64).
    assert "d2660b50a9ed59eada480750561c96abc2ed4c9a38c6a24d93e30e0977631398" in texte
    assert "https://dl.filippo.io/mkcert/v1.4.4?for=windows/amd64" in texte
    assert "FiloSottile.mkcert" in texte  # chemin winget officiel
    # Le script PROUVE (requêtes réelles) au lieu de promettre.
    assert "https://localhost:8443/" in texte and "Invoke-WebRequest" in texte
    # Le retrait conserve la CA et le dit (pas de confiance retirée en douce).
    texte_retirer = ps_retirer.read_text(encoding="ascii")
    assert "mkcert -uninstall" in texte_retirer and "CONSERVE" in texte_retirer


def test_gitignore_protects_private_key_material():
    assert "infra/tls/certs/*" in GITIGNORE, "les vrais certificats doivent être exclus du git"
    assert "infra/tls/enabled/*" in GITIGNORE, "la bascule d'activation est un état local"


def test_no_real_certificate_committed():
    # Garde-fou anti-fuite : aucun .pem réel ne doit être versionné dans
    # infra/tls (les .gitkeep autorisés). Les certificats du casino de test
    # backend vivent ailleurs — ici, c'est le dossier d'exploitation client.
    pems = list((ROOT / "infra" / "tls").rglob("*.pem"))
    assert not pems, f"certificat(s) réel(s) trouvé(s) dans le dépôt : {pems}"


def test_readme_mentions_the_double_clickable_file():
    assert "8_ACTIVER_HTTPS_LOCAL.bat" in README, "README doit citer le fichier opérateur §119"
