"""§75 — Verrou anti-dérive du manifeste D'IMAGE (requirements-api.txt).

Incident du 2026-08-09 : l'image de PRODUCTION (construite depuis
requirements-api.txt, et NON requirements.txt) refusait de démarrer —
backend « unhealthy » : ``ModuleNotFoundError: ezdxf``, ajouté au §67 à
requirements.txt mais oublié dans le manifeste réellement utilisé par le
Dockerfile (build arg REQUIREMENTS_FILE=requirements-api.txt).

Ce test scanne par AST les imports *module-level* de tout ``app/`` (ceux
exécutés au démarrage d'uvicorn — les imports paresseux au niveau fonction
ne bloquent pas le boot) et exige que chaque paquet tiers soit couvert par
le manifeste de production. S'il échoue : on corrige le manifeste, pas le test.
"""

import ast
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
API_MANIFEST = BACKEND / "requirements-api.txt"

# Module importé → paquet pip qui le FOURNIT (quand les noms diffèrent,
# ou quand la couverture est transitive : botocore vient avec boto3,
# langchain_core avec le paquet « langchain », etc.).
MODULE_TO_PACKAGE = {
    "jwt": "pyjwt",
    "multipart": "python-multipart",
    "email_validator": "email-validator",
    "sentry_sdk": "sentry-sdk",
    "psycopg2": "psycopg2-binary",
    "pydantic_settings": "pydantic-settings",
    "prometheus_client": "prometheus-client",
    "uvicorn_worker": "uvicorn-worker",
    "argon2": "argon2-cffi",
    "yaml": "pyyaml",
    "PIL": "pillow",
    "bs4": "beautifulsoup4",
    "botocore": "boto3",                    # dépendance transitive de boto3
    "langchain_core": "langchain",          # dépendance transitive de langchain
    "opentelemetry": "opentelemetry-api",   # paquet racine de la famille OTel
    "starlette": "fastapi",                 # dépendance transitive de fastapi
    "pythonjsonlogger": "python-json-logger",
}

_STDLIB = set(getattr(sys, "stdlib_module_names", ())) | set(sys.builtin_module_names)


def _manifest_packages() -> set[str]:
    pkgs: set[str] = set()
    for raw in API_MANIFEST.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        name = line.split("=")[0].split("[")[0].split(">")[0].split("<")[0].split("~")[0].strip()
        if name:
            pkgs.add(name.lower().replace("-", "_"))
    return pkgs


def _module_level_imports() -> set[str]:
    """Imports exécutés à l'import du module (haut de fichier + try/except
    d'imports optionnels en tête de module). Les imports dans les fonctions
    (paresseux) sont volontairement exclus : ils ne bloquent pas le boot."""
    mods: set[str] = set()
    for path in (BACKEND / "app").rglob("*.py"):
        # app/scripts = outillage one-shot d'opérateur (ex. import_german_
        # prices_2026.py → pdfplumber), JAMAIS importé par le processus web :
        # hors périmètre du manifeste d'image (ses deps restent à installer
        # à la main sur la machine qui l'exécute, doc dans le script).
        if "scripts" in path.relative_to(BACKEND / "app").parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in tree.body:
            if isinstance(node, ast.Import):
                mods.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                mods.add(node.module.split(".")[0])
            # Les try/except ImportError en tête de module (imports
            # OPTIONNELS, ex. OpenTelemetry) sont volontairement ignorés :
            # par construction, ils ne peuvent pas planter le démarrage.
    return mods


def _local_modules() -> set[str]:
    names = {p.stem for p in (BACKEND / "app").glob("*.py")}
    names |= {p.name for p in (BACKEND / "app").iterdir() if p.is_dir()}
    names.add("app")
    return names


def test_requirements_api_covers_startup_imports():
    """Aucun import de démarrage ne doit manquer dans requirements-api.txt."""
    pkgs = _manifest_packages()
    local = _local_modules()
    manquants: dict[str, str] = {}
    for mod in sorted(_module_level_imports()):
        if mod in _STDLIB or mod in local:
            continue
        package = MODULE_TO_PACKAGE.get(mod, mod).lower().replace("-", "_")
        if package not in pkgs:
            manquants[mod] = package
    assert not manquants, (
        "requirements-api.txt (le manifeste RÉELLEMENT utilisé par le Dockerfile) "
        f"ne couvre pas ces imports de démarrage : {manquants}. C'est EXACTEMENT "
        "la panne de prod du 2026-08-09 (ezdxf manquant) — corriger le manifeste, "
        "pas ce test."
    )


def test_ezdxf_present_pour_la_route_dxf_section_67():
    """Cas d'école : le §67 (analyse DXF ezdxf) est atteint au boot de l'API."""
    pkgs = _manifest_packages()
    assert "ezdxf" in pkgs, "ezdxf requis par app/services/dxf_analysis.py (§67)"
    assert "ifcopenshell" in pkgs, "ifcopenshell requis par le pipeline IFC (imports paresseux)"
