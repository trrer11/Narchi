"""§89 — V2.7 étape 3 (2/2) : positions LV STRUCTURÉES co-éditées.

Le document CRDT partagé (le MÊME Doc que la Notiz §81/§86 — une seule
connexion, une seule persistance) porte désormais aussi une clé ``lv`` :
un Y.Array de Y.Map — une ligne = UNE position de Leistungsverzeichnis
(OZ, Kurztext, Menge, Einheit, EP, price_hint). Ce module extrait ces
positions d'un état binaire persisté (``collab_docs.state``) pour les
servir en JSON — matière première du futur export GAEB (X31/X83).

Contrat d'honnêteté, miroir EXACT du validateur frontend (lvOps.ts) :

- toute entrée qui n'est pas une Map est ignorée (jamais de donnée
  aveugle) ;
- une position sans ``id`` valide, ou avec ``qty``/``unit_price``
  corrompus (texte, NaN, négatif, > 1 milliard), est IGNORÉE, pas
  devinée — le compte rendu reflète ce qui est réellement lisible ;
- ``unit_price`` absent (null) est LÉGAL : position « ohne EP » — le
  total ne l'inclut pas et le compte est renvoyé à part (charte §36
  « kein Preis ohne Herkunft » : l'EP est ici une saisie manuelle,
  dite comme telle).
"""

from __future__ import annotations

import math
from decimal import Decimal
from typing import Any

from pycrdt import Array, Doc, Map

from app.services.money import eur

LV_KEY = "lv"
LV_MAX_POSITIONS = 500        # borne affichée — identique au frontend
MAX_OZ_LEN = 32
MAX_TITLE_LEN = 300
MAX_UNIT_LEN = 12
MAX_HINT_LEN = 40
MAX_NUMBER = 1_000_000_000

_MISSING = object()


def _clean_text(value: Any, max_len: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_len]


def _num(value: Any, *, allow_none: bool) -> Any:
    """Nombre fini ≥ 0 borné ; `_MISSING` quand la donnée est corrompue."""
    if value is None:
        return None if allow_none else _MISSING
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return _MISSING
    num = float(value)
    if not math.isfinite(num) or num < 0 or num > MAX_NUMBER:
        return _MISSING
    return num


def extract_lv_positions(state: bytes) -> list[dict[str, Any]]:
    """Positions LV d'un état binaire CRDT, ordre du tableau conservé.

    Ne lève JAMAIS : état vide/corrompu → [] (l'UI affiche alors
    honnêtement « noch keine Positionen »).
    """
    try:
        doc = Doc()
        doc.apply_update(bytes(state))
        yarr = doc.get(LV_KEY, type=Array)
        raw = [el.to_py() for el in yarr if isinstance(el, Map)]
    except Exception:
        return []
    positions: list[dict[str, Any]] = []
    for el in raw:
        if not isinstance(el, dict):
            continue
        pid = el.get("id")
        if not isinstance(pid, str) or not pid:
            continue
        qty = _num(el.get("qty"), allow_none=False)
        unit_price = _num(el.get("unit_price"), allow_none=True)
        if qty is _MISSING or unit_price is _MISSING:
            continue
        positions.append({
            "id": pid,
            "oz": _clean_text(el.get("oz"), MAX_OZ_LEN),
            "title": _clean_text(el.get("title"), MAX_TITLE_LEN),
            "qty": qty,
            "unit": _clean_text(el.get("unit"), MAX_UNIT_LEN),
            "unit_price": unit_price,      # null = « ohne EP » — dit, pas caché
            "price_hint": _clean_text(el.get("price_hint"), MAX_HINT_LEN) or "manuell",
            # §145 — gp (Gesamtpreis) en HALF_UP : 3 × 33,335 → 100.01 (jamais
            # 100.00 — banker's rounding de round() corrigé). Le type du
            # champ reste float côté CRDT ; seul le TOTAL affiché est exact.
            "gp": float(eur(Decimal(str(qty)) * Decimal(str(unit_price))))
            if unit_price is not None
            else None,
        })
        if len(positions) >= LV_MAX_POSITIONS:
            break                      # borne servie, jamais dépassée en silence
    return positions


def lv_totals(positions: list[dict[str, Any]]) -> dict[str, int | float]:
    """Comptes honnêtes : total des positions AVEC prix + nombre sans EP."""
    ohne_ep = sum(1 for p in positions if p["unit_price"] is None)
    # §145 — somme en HALF_UP (chaque gp est déjà un centime exact), jamais
    # round() banker's sur une somme de floats.
    gp_total = float(
        sum((eur(p["gp"]) for p in positions if p["gp"] is not None), Decimal("0"))
    )
    return {"count": len(positions), "ohne_ep": ohne_ep, "gp_total": gp_total}
