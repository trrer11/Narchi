"""§145 — Argent côté ESTIMATION : conversions en centimes / euros, HALF_UP.

Le pipeline E-Rechnung a `calculer_totaux()` (Decimal partout, §114). Le
pipeline ESTIMATION, lui, reçoit des nombres FLOAT (issus du CRDT Yjs / du
moteur d'indexation) et doit les convertir en CENTIMES ENTIERS pour comparer
des prix (Angebotsvergleich §92) ou en EUROS pour afficher un total
(positions LV §89).

LE BUG corrigé ici : `round(float(x) * 100)` et `round(x, 2)` de Python font
du **banker's rounding** (arrondi au pair), PAS du HALF_UP. Résultat mesuré
avant correction :

  * `round(0.025 * 100) = 2` cents  (HALF_UP correct = 3) ;
  * `round(12.345 * 100) = 1234`    (HALF_UP correct = 1235) ;
  * `round(3 * 33.335, 2) = 100.0`  (HALF_UP correct = 100.01).

Une offre à 12,345 € était donc comparée à 12,34 € au lieu de 12,35 € — un
centime de dérive sur la décision « meilleure offre ». Ces helpers imposent
le HALF_UP partout où un float d'argent doit devenir des centimes ou des
euros.

`Decimal(str(x))` est la conversion sûre d'un float : `str()` donne la
représentation décimale la plus courte qui redonne le MÊME float — c'est la
valeur que l'utilisateur a saisie (ex. « 33.335 »), pas son binaire approximé.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

_CENT = Decimal("0.01")
_EUR = Decimal("1")


def to_cents(value: object) -> int:
    """float/str/Decimal/int → centimes ENTIERS, arrondi HALF_UP.

    Miroir exact de la conversion de gaeb_import.py §91 (déjà correcte) :
    `int((Decimal * 100).quantize(1, HALF_UP))`. 12,345 → 1235 ; 0,025 → 3.

    Lève ValueError si la valeur n'est pas un nombre fini (on ne DEVINE
    jamais un prix illisible — le refus est dit, pas masqué).
    """
    d = _as_decimal(value)
    return int((d * 100).quantize(_EUR, rounding=ROUND_HALF_UP))


def eur(value: object) -> Decimal:
    """float/str/Decimal/int → euros à 2 décimales, arrondi HALF_UP.

    3 × 33,335 → Decimal('100.01') (jamais 100.00). Lève ValueError sur un
    nombre non fini.
    """
    d = _as_decimal(value)
    return d.quantize(_CENT, rounding=ROUND_HALF_UP)


def _as_decimal(value: object) -> Decimal:
    if isinstance(value, bool):
        raise ValueError(f"bool n'est pas un prix : {value!r}")
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        # str(float) = représentation décimale la plus courte (la saisie).
        return Decimal(str(value))
    if isinstance(value, str):
        try:
            return Decimal(value.strip().replace(",", ".") or "0")
        except InvalidOperation as exc:  # pragma: no cover — défensif
            raise ValueError(f"prix illisible : {value!r}") from exc
    raise ValueError(f"type non convertible en prix : {type(value).__name__}")
