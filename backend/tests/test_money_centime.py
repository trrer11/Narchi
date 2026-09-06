"""§145 — Le centime ne dérive plus : HALF_UP au lieu de banker's rounding.

Régression épinglée : avant correction, `round(float(x)*100)` et `round(x,2)`
de Python faisaient du banker's rounding (arrondi au pair), PAS du HALF_UP
requis par la charte monétaire §114. Résultat : une offre à 12,345 € était
comparée à 12,34 € au lieu de 12,35 €.

Ces tests verrouillent :
  * `money.to_cents()` / `money.eur()` (les helpers partagés) ;
  * `offer_compare.build_comparison` (la décision « meilleure offre ») ;
  * `lv_positions` (le Gesamtpreis `gp` et la somme `lv_totals`).
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.money import eur, to_cents
from app.services.offer_compare import build_comparison


class TestMoneyHelpers:
    @pytest.mark.parametrize(
        "value, attendu",
        [
            (0.025, 3),       # banker's donnerait 2
            (0.045, 5),       # banker's donnerait 4
            (0.125, 13),      # banker's donnerait 12
            (12.345, 1235),   # banker's donnerait 1234
            (33.335, 3334),   # cas limite déjà correct, épinglé
            (1.005, 101),     # banker's donnerait 100
            (100.0, 10000),
            ("12.345", 1235),  # chaîne aussi acceptée
            (Decimal("0.025"), 3),
        ],
    )
    def test_to_cents_half_up(self, value, attendu):
        assert to_cents(value) == attendu

    @pytest.mark.parametrize(
        "qty, up, attendu",
        [
            (3.0, 33.335, Decimal("100.01")),   # banker's donnerait 100.0
            (1.0, 0.025, Decimal("0.03")),      # banker's donnerait 0.02
            (12.5, 100.0, Decimal("1250.00")),
        ],
    )
    def test_eur_half_up(self, qty, up, attendu):
        assert eur(Decimal(str(qty)) * Decimal(str(up))) == attendu

    def test_refus_sur_non_nombre(self):
        with pytest.raises(ValueError):
            to_cents("abc")
        with pytest.raises(ValueError):
            eur(True)  # bool n'est pas un prix


class TestOfferCompareCentime:
    def test_internal_up_cents_half_up(self):
        """Une offre interne à 0,025 €/m³ → 3 centimes (jamais 2)."""
        internal = [
            {"id": "i-1", "oz": "01.001", "title": "Intern", "qty": 1.0,
             "unit": "m³", "unit_price": 0.025, "price_hint": "manuell", "gp": None},
        ]
        offre = [{"id": "A", "company_name": "Bauer", "dp": "83",
                  "items": [{"oz": "001.00001", "up_cents": 3, "it_cents": 3}]}]
        matrix = build_comparison(internal, offre)
        assert matrix["rows"][0]["internal_up_cents"] == 3  # HALF_UP, pas 2

    def test_internal_up_cents_12_345(self):
        internal = [
            {"id": "i-1", "oz": "01.001", "title": "Intern", "qty": 1.0,
             "unit": "m³", "unit_price": 12.345, "price_hint": "manuell", "gp": None},
        ]
        matrix = build_comparison(internal, [])
        assert matrix["rows"][0]["internal_up_cents"] == 1235  # pas 1234


class TestLvPositionsCentime:
    def _build(self, qty: float, unit_price: float) -> dict:
        """Construit un état binaire CRDT minimal via pycrdt (comme le vrai)."""
        from pycrdt import Array, Doc, Map

        doc = Doc()
        yarr = doc.get("lv", type=Array)
        with doc.transaction():
            yarr.append(Map({
                "id": "p1", "oz": "01.001", "title": "Test", "qty": qty,
                "unit": "m³", "unit_price": unit_price, "price_hint": "manuell",
            }))
        return {"state": bytes(doc.get_update())}

    def test_gp_half_up_33_335(self):
        from app.services.lv_positions import extract_lv_positions

        positions = extract_lv_positions(self._build(3.0, 33.335)["state"])
        assert positions[0]["gp"] == 100.01  # jamais 100.0 (banker's)

    def test_lv_totals_half_up(self):
        from app.services.lv_positions import extract_lv_positions, lv_totals

        positions = extract_lv_positions(self._build(3.0, 33.335)["state"])
        totals = lv_totals(positions)
        assert totals["gp_total"] == 100.01
        assert totals["ohne_ep"] == 0
