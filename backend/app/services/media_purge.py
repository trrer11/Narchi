"""§125 — Purge des médias orphelins côté serveur (backlog dit depuis §120).

LE PROBLÈME — Depuis §118, les photos/vidéos des Mängel vivent sous
`<NARCHI_MEDIA_DIR>/<bureau>/<id>` (+`<id>.meta`), et AUCUNE suppression
serveur n'existait (tombstone = le Mangel supprimé reste prouvable, mais
son FICHIER ne partait jamais). Sur un petit serveur de bureau, le volume
gonfle indéfiniment. Ce module offre le ménage — conservateur par
construction :

Règle d'or : ON NE SUPPRIME JAMAIS UN FICHIER QU'UN APPAREIL HORS-LIGNE
POURRAIT ENCORE RÉCLAMER. Le delta-sync §115-§119 n'honore qu'un horizon
fini (30 jours par défaut, choix DIT ici, modifiable) : au-delà, une
pierre tombale est réputée arrivée partout et son fichier = résidu pur.

Un fichier <id> (+ son .meta) n'est candidat QUE si :
  R1 — aucun Mangel VIVANT (deleted_at IS NULL) ne le référence (sinon :
       conservé, toujours, même vieux) ;
  R2 — aucune pierre tombale RÉCENTE (< horizon) ne le référence (sinon :
       conservé — un appareil peut ne pas avoir encore tiré la tombe) ;
  R3 — et l'une des deux horloges fiables dit « vieux » :
       a) référencé par une tombale ÂGÉE (horloge = deleted_at, la vérité) ;
       b) jamais référencé nulle part ET mtime du fichier > horizon
          (course possible avec un appareil hors-ligne → mtime seul juge).

Résidus techniques, mêmes horloges : « <id>.part » (upload atomique §118
interrompu ; jamais référençable par construction) purgeable si plus vieux
que ``part_heures`` (24 h DIT) ; « <id>.meta » sans son fichier = résidu,
purgeable si plus vieux que l'horizon.

Gardes STRUCTURELLES : les noms de fichiers qui ne satisfont pas la même
expression sûre que la route §118 sont IGNORÉS (jamais supprimés — un
fichier étranger posé à la main n'est pas notre affaire) ; rien n'est
suivi hors du répertoire racine ; le mode par défaut est SIMULATION
(dry-run) — la suppression exige ``appliquer=True`` ET est journalisée
fichier par fichier avec le total d'octets libérés. Pas de magie silencieuse.

Usage ops (dans le conteneur : dossier ``/app/storage/media``) :

    python -m app.services.media_purge                      # simulation seule
    python -m app.services.media_purge --supprimer          # purge réelle
    python -m app.services.media_purge --jours 60 --tenant bureau_x
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from app.core.logging import get_logger
from app.models.baustelle_issue import BaustelleIssue

logger = get_logger("media_purge")

HORIZON_JOURS_DEFAUT = 30   # choix DIT : horizon de synchro honoraire max
PART_HEURES_DEFAUT = 24     # upload atomique interrompu = résidu au-delà

# Même garde que la route §118 : hors de ce profil, on ne touche à RIEN.
_ID_SUR = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

RAISON_TOMBALE = "mangel supprimé il y a plus de l'horizon (tombale âgée)"
RAISON_JAMAIS_REF = "jamais référencé en base et plus vieux que l'horizon"
RAISON_PART = "upload interrompu (.part) plus vieux que 24 h"
RAISON_META = ".meta orphelin (fichier absent) plus vieux que l'horizon"


@dataclass(frozen=True)
class Candidat:
    """Un fichier proposé à la purge — la raison est TOUJOURS écrite."""

    chemin: Path
    taille: int
    raison: str


@dataclass
class PlanPurge:
    """Résultat de l'analyse : candidats mesurés + compteurs de conservation
    (un outil honnête dit aussi ce qu'il a GARDÉ)."""

    candidats: list[Candidat] = field(default_factory=list)
    conserves_vivants: int = 0
    conserves_tombale_recente: int = 0
    conserves_trop_jeunes: int = 0
    ignores_nom_inattendu: list[str] = field(default_factory=list)

    @property
    def octets_recuperables(self) -> int:
        return sum(c.taille for c in self.candidats)


def collecter_references(db, horizon_jours: int = HORIZON_JOURS_DEFAUT) -> tuple[set[str], set[str], set[str]]:
    """Lit la table des Mängel et rend trois ensembles d'ids de médias :
    (référencés vivants, référencés par tombale récente, par tombale âgée).
    L'horloge fiable est ``deleted_at`` — jamais le disque."""
    refs_vivants: set[str] = set()
    refs_tombe_recente: set[str] = set()
    refs_tombe_agee: set[str] = set()
    # Horloge = deleted_at (la vérité base). SQLite rend des dates NAÏVES
    # même pour DateTime(timezone=True) — normalisé comme au §115 (_aware).
    limite = datetime.now(timezone.utc) - timedelta(days=horizon_jours)
    rows = db.execute(
        select(
            BaustelleIssue.photo_ids,
            BaustelleIssue.video_ids,
            BaustelleIssue.deleted_at,
        )
    ).all()
    for photo_ids, video_ids, deleted_at in rows:
        ids = {str(i) for i in (photo_ids or []) + (video_ids or [])}
        if deleted_at is None:
            refs_vivants |= ids
            continue
        quand = deleted_at if deleted_at.tzinfo else deleted_at.replace(tzinfo=timezone.utc)
        if quand < limite:
            refs_tombe_agee |= ids
        else:
            refs_tombe_recente |= ids
    # Priorités : vivant > tombe récente > tombe âgée (un même id peut
    # apparaître dans plusieurs Mängel).
    refs_tombe_recente -= refs_vivants
    refs_tombe_agee -= refs_vivants | refs_tombe_recente
    return refs_vivants, refs_tombe_recente, refs_tombe_agee


def analyser(
    root: Path,
    refs_vivants: set[str],
    refs_tombe_recente: set[str],
    refs_tombe_agee: set[str],
    *,
    maintenant: float | None = None,
    horizon_jours: int = HORIZON_JOURS_DEFAUT,
    part_heures: int = PART_HEURES_DEFAUT,
    seul_tenant: str | None = None,
) -> PlanPurge:
    """Construit le plan (aucune écriture disque ici — la lecture seule)."""
    plan = PlanPurge()
    t = time.time() if maintenant is None else maintenant
    horizon = horizon_jours * 86400
    if not root.is_dir():
        return plan  # pas de volume : rien à dire, pas d'erreur inventée
    for tenant_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        if seul_tenant is not None and tenant_dir.name != seul_tenant:
            continue
        fichiers = {p.name: p for p in tenant_dir.iterdir() if p.is_file()}
        medias = [n for n in fichiers if not n.endswith((".meta", ".part"))]
        for nom in medias:
            if not _ID_SUR.match(nom):
                plan.ignores_nom_inattendu.append(f"{tenant_dir.name}/{nom}")
                continue
            chemin = fichiers[nom]
            compagnon = fichiers.get(nom + ".meta")
            taille = chemin.stat().st_size + (compagnon.stat().st_size if compagnon else 0)
            if nom in refs_vivants:
                plan.conserves_vivants += 1
                continue
            if nom in refs_tombe_recente:
                plan.conserves_tombale_recente += 1
                continue
            if nom in refs_tombe_agee:
                raison = RAISON_TOMBALE
            elif chemin.stat().st_mtime < t - horizon:
                raison = RAISON_JAMAIS_REF
            else:
                plan.conserves_trop_jeunes += 1
                continue
            plan.candidats.append(Candidat(chemin, taille, raison))
            if compagnon:
                plan.candidats.append(Candidat(compagnon, compagnon.stat().st_size, raison))
        # Résidus techniques : .part abandonnés, .meta orphelins.
        for nom, chemin in sorted(fichiers.items()):
            if nom.endswith(".part"):
                if chemin.stat().st_mtime < t - part_heures * 3600:
                    plan.candidats.append(Candidat(chemin, chemin.stat().st_size, RAISON_PART))
            elif nom.endswith(".meta") and nom[: -len(".meta")] not in medias:
                if chemin.stat().st_mtime < t - horizon:
                    plan.candidats.append(Candidat(chemin, chemin.stat().st_size, RAISON_META))
    return plan


def appliquer(plan: PlanPurge) -> tuple[int, int]:
    """Supprime RÉELLEMENT les candidats. Rend (fichiers, octets libérés).
    Chaque suppression est journalisée — jamais de ménage silencieux."""
    supprimes = 0
    octets = 0
    for c in plan.candidats:
        try:
            c.chemin.unlink()
        except FileNotFoundError:
            continue  # parti entre l'analyse et l'acte : dit, pas grave
        supprimes += 1
        octets += c.taille
        logger.info("media.purge fichier=%s octets=%s raison=%s", c.chemin, c.taille, c.raison)
    return supprimes, octets


def _mib(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} Mio"


def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Purge des médias orphelins (§125)")
    ap.add_argument("--supprimer", action="store_true", help="purge réelle (défaut : simulation)")
    ap.add_argument("--jours", type=int, default=HORIZON_JOURS_DEFAUT, help="horizon de synchro (défaut 30)")
    ap.add_argument("--part-heures", type=int, default=PART_HEURES_DEFAUT)
    ap.add_argument("--tenant", default=None, help="un seul bureau (défaut : tous)")
    ap.add_argument("--root", default=os.environ.get("NARCHI_MEDIA_DIR", "/app/storage/media"))
    args = ap.parse_args(argv)

    from app.database import SessionLocal  # import tardif : lecture de config à l'usage

    db = SessionLocal()
    try:
        vivants, recente, agee = collecter_references(db, args.jours)
    finally:
        db.close()
    plan = analyser(
        Path(args.root),
        vivants,
        recente,
        agee,
        horizon_jours=args.jours,
        part_heures=args.part_heures,
        seul_tenant=args.tenant,
    )
    print(f"Référencés : {len(vivants)} vivants · {len(recente)} tombe récente · {len(agee)} tombe âgée")
    print(
        f"Conservés : {plan.conserves_vivants} vivants · {plan.conserves_tombale_recente} "
        f"tombe récente · {plan.conserves_trop_jeunes} trop jeunes — jamais touchés."
    )
    for c in plan.candidats:
        print(f"  {'SUPPRIMÉ' if args.supprimer else 'à purger'} : {c.chemin} ({c.taille} o) — {c.raison}")
    for nom in plan.ignores_nom_inattendu:
        print(f"  IGNORÉ (nom inattendu, on n'y touche pas) : {nom}")
    if args.supprimer:
        n, o = appliquer(plan)
        print(f"PURGE RÉELLE : {n} fichiers, {_mib(o)} libérés.")
    else:
        print(f"SIMULATION : {len(plan.candidats)} fichiers, {_mib(plan.octets_recuperables)} récupérables. Rien supprimé.")
    return 0


if __name__ == "__main__":  # python -m app.services.media_purge
    sys.exit(_main(sys.argv[1:]))
