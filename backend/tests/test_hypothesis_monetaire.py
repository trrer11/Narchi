"""§139 — Property-based testing (Hypothesis) sur l'ARGENT : les invariants
monétaires de Narchi deviennent des PROPRIÉTÉS testées sur des milliers de
cas aléatoires, pas des exemples figés.

Pourquoi c'est le filet « fiabilité irréprochable » : les tests unitaires
§114/§116 épinglent des cas PRÉCIS (3×33,3350=100,01 ; 87,50×7 %=6,13). Ici,
Hypothesis explore des MILLIERS de quantités/prix/taux et vérifie que les
invariants tiennent PARTOUT :

  1. jamais de float (tout est Decimal) ;
  2. chaque total est un centime EXACT (jamais plus de 2 décimales) ;
  3. net + tva = brut (la somme des groupes = TVA totale) ;
  4. arrondi IDEMPOTENT (quantize deux fois = quantize une fois) ;
  5. round-trip XML : le montant DANS le CII == le total calculé (le fichier
     ne diverge jamais d'un centime de l'arithmétique partagée) ;
  6. la TVA par groupe est HALF_UP cohérente avec la somme des groupes.

Une étude (ACM 2025) mesure qu'un test par propriété tue ~52× plus de mutants
qu'un test unitaire — c'est ce qui justifie d'ajouter ce filet au-dessus des
541 tests existants.

Réglage CI : ces tests tournent dans la suite normale (backend pytest) avec
un budget d'exemples BORNÉ (settings derandomized pour la reproductibilité en
CI — voir les commentaires en bas).
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from decimal import ROUND_HALF_UP, Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.xrechnung import (
    LigneFacture,
    calculer_totaux,
    construire_cii,
    _fmt_montant,
    _fmt_prix,
    _MONTANT_PLACES,
)

CENT = Decimal("0.01")

# --- Stratégies bornées : le domaine RÉEL des factures Narchi ----------------
# quantités et prix positifs, jusqu'à 4 décimales (le cas réel §114 des
# honoraires à 4 décimales) ; taux = les deux taux supportés (19 / 7), car
# l'UI n'offre que « S » (catégorie TVA allemande normale).

quantite = st.decimals(min_value=Decimal("0.0001"), max_value=Decimal("10000"), places=4)
prix = st.decimals(min_value=Decimal("0.0001"), max_value=Decimal("100000"), places=4)
taux = st.sampled_from([Decimal("19"), Decimal("7")])

lignes_strategy = st.lists(
    st.tuples(quantite, prix, taux),
    min_size=1,
    max_size=12,
)


def _lignes(tuples) -> tuple[LigneFacture, ...]:
    return tuple(
        LigneFacture(
            designation=f"L{i}",
            quantite=q,
            unite="piece",
            prix_unitaire_ht=p,
            taux_tva=t,
            categorie_tva="S",
        )
        for i, (q, p, t) in enumerate(tuples, start=1)
    )


@settings(max_examples=400, derandomize=True)
@given(lignes_strategy)
def test_invariants_monetaires_tiennent_partout(tuples):
    ls = _lignes(tuples)
    tot = calculer_totaux(ls)

    # 1) jamais de float : les sorties sont des Decimal.
    for cle in ("net", "tva", "brut"):
        assert isinstance(tot[cle], Decimal), f"{cle} n'est pas Decimal"

    # 2) centimes exacts : chaque total a AU PLUS 2 décimales.
    for cle in ("net", "tva", "brut"):
        assert tot[cle].as_tuple().exponent >= -2, (
            f"{cle}={tot[cle]} a plus de 2 décimales"
        )

    # 3) net + tva = brut (identité de clôture).
    assert tot["net"] + tot["tva"] == tot["brut"]

    # 4) la TVA totale == somme des TVA par groupe (recalculées identiquement).
    tva_groupes = Decimal(0)
    for (t, _cat), base in tot["groupes"].items():
        tva_groupes += (base * t / Decimal(100)).quantize(CENT, ROUND_HALF_UP)
    assert tva_groupes == tot["tva"]

    # 5) arrondi idempotent : re-quantize = identique (jamais de dérive).
    assert tot["net"].quantize(CENT, ROUND_HALF_UP) == tot["net"]
    assert tot["brut"].quantize(CENT, ROUND_HALF_UP) == tot["brut"]

    # 6) les bases des groupes sont des centimes exacts (lignes déjà arrondies).
    for base in tot["groupes"].values():
        assert base.as_tuple().exponent >= -2


@settings(max_examples=200, derandomize=True)
@given(lignes_strategy)
def test_round_trip_xml_ne_diverge_jamais_du_total(tuples):
    """Le montant ÉCRIT dans le CII (reparsé) == le total calculé : le fichier
    ne diverge jamais d'un centime de l'arithmétique partagée §114/§116."""
    ls = _lignes(tuples)
    tot = calculer_totaux(ls)

    # Construire un XML VALIDE nécessite une facture complète : on réutilise
    # la fixture §114 (facture_ok) et on REMPLACE ses lignes par les nôtres.
    from dataclasses import replace

    from test_xrechnung import facture_ok

    fac = replace(facture_ok(), lignes=ls)
    xml = construire_cii(fac, "en16931")
    racine = ET.fromstring(xml.encode("utf-8"))
    NS = {
        "rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
        "ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
    }
    somme = "rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation"
    grand = racine.find(f"{somme}/ram:GrandTotalAmount", NS)
    assert grand is not None and grand.text is not None
    brut_xml = Decimal(grand.text)
    assert brut_xml == tot["brut"], f"XML={brut_xml} vs calculé={tot['brut']}"

    tax_total = racine.find(f"{somme}/ram:TaxTotalAmount", NS)
    assert tax_total is not None and tax_total.text is not None
    assert Decimal(tax_total.text) == tot["tva"]


@settings(max_examples=200, derandomize=True)
@given(lignes_strategy)
def test_formatage_centime_stable(tuples):
    """Les formatages _fmt_montant / _fmt_prix produisent des chaînes
    cohérentes avec le re-parse (aucune perte d'information d'arrondi)."""
    ls = _lignes(tuples)
    tot = calculer_totaux(ls)
    for cle in ("net", "tva", "brut"):
        s = _fmt_montant(tot[cle])
        assert Decimal(s) == tot[cle].quantize(CENT, ROUND_HALF_UP)
    for li in ls:
        s = _fmt_prix(li.prix_unitaire_ht)
        # _fmt_prix quantize à 4 décimales : le re-parse == la valeur quantisée.
        assert Decimal(s) == li.prix_unitaire_ht.quantize(Decimal("0.0001"), ROUND_HALF_UP)
