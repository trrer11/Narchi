"""§67 — Vague 1 honnêteté formats : analyse DXF réelle (ezdxf) + refus
explicite .dwg/.rvt (ils étaient acceptés mais jamais parsés).

Doctrine §36 : les tests prouvent que CHAQUE valeur renvoyée est mesurée
dans un fichier DXF fabriqué pour l'occasion — jamais de donnée inventée.
"""

from __future__ import annotations

import io
import importlib
import os
from pathlib import Path

import ezdxf
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

import sys

for path in (str(REPO_ROOT), str(REPO_ROOT / "backend")):
    if path not in sys.path:
        sys.path.insert(0, path)

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("DB_USE_PGBOUNCER", "false")
os.environ.setdefault("LEGACY_SHA256_SALT", "x")

from app.services.dxf_analysis import (  # noqa: E402
    DxfAnalysisError,
    analyze_dxf_bytes,
)


def _dxf_bytes(build) -> bytes:
    doc = ezdxf.new("R2010")
    build(doc)
    buffer = io.StringIO()
    doc.write(buffer)
    return buffer.getvalue().encode("utf-8")


@pytest.fixture()
def sample_dxf() -> bytes:
    def build(doc) -> None:
        doc.header["$INSUNITS"] = 6  # mètres
        doc.layers.add("WANDS", color=3)
        doc.layers.add("TEXTSEBENE", color=1)
        doc.blocks.new("TUER")
        msp = doc.modelspace()
        # Carré fermé 10 × 10 m sur WANDS → 100,000 m² attendus.
        msp.add_lwpolyline(
            [(0, 0), (10, 0), (10, 10), (0, 10)], close=True, dxfattribs={"layer": "WANDS"}
        )
        msp.add_line((0, 0), (5, 5), dxfattribs={"layer": "WANDS"})
        msp.add_circle((2, 2), radius=5, dxfattribs={"layer": "0"})
        msp.add_text("Bad", dxfattribs={"layer": "TEXTSEBENE"})
        msp.add_blockref("TUER", (1, 1), dxfattribs={"layer": "WANDS"})

    return _dxf_bytes(build)


class TestRealMeasurement:
    def test_version_and_units_are_read_from_file(self, sample_dxf: bytes) -> None:
        result = analyze_dxf_bytes(sample_dxf, "grundriss.dxf")
        assert result["filename"] == "grundriss.dxf"
        assert result["dxf_version"] == "AC1024"  # R2010 — lu, pas deviné
        assert result["units"] == "Meter (m)"
        assert result["analysis_kind"] == "dxf_2d"

    def test_closed_polyline_area_is_measured(self, sample_dxf: bytes) -> None:
        result = analyze_dxf_bytes(sample_dxf, "a.dxf")
        assert result["closed_polyline_area_total"] == pytest.approx(100.0)
        wand = next(layer for layer in result["layers"] if layer["name"] == "WANDS")
        assert wand["closed_polyline_area"] == pytest.approx(100.0)
        assert wand["entity_count"] == 3  # polyligne + ligne + réf. bloc

    def test_entity_block_text_counts_are_measured(self, sample_dxf: bytes) -> None:
        result = analyze_dxf_bytes(sample_dxf, "a.dxf")
        assert result["entity_counts"]["LWPOLYLINE"] == 1
        assert result["entity_counts"]["LINE"] == 1
        assert result["entity_counts"]["CIRCLE"] == 1
        assert result["entity_total"] == 5
        assert result["block_definition_count"] == 1  # TUER (les * sont exclus)
        assert result["block_reference_count"] == 1
        assert result["text_entity_count"] == 1

    def test_layers_sorted_by_entity_count(self, sample_dxf: bytes) -> None:
        result = analyze_dxf_bytes(sample_dxf, "a.dxf")
        assert result["layer_count"] == 3
        assert result["layers"][0]["name"] == "WANDS"

    def test_millimeter_units_scale_area_to_square_meters(self) -> None:
        def build(doc) -> None:
            doc.header["$INSUNITS"] = 4  # millimètres
            # 10 000 × 10 000 mm → 100 m² si le facteur est honnête.
            doc.modelspace().add_lwpolyline(
                [(0, 0), (10000, 0), (10000, 10000), (0, 10000)], close=True
            )

        result = analyze_dxf_bytes(_dxf_bytes(build), "mm.dxf")
        assert result["units"] == "Millimeter (mm)"
        assert result["closed_polyline_area_total"] == pytest.approx(100.0)

    def test_area_method_discloses_chord_approximation(self, sample_dxf: bytes) -> None:
        result = analyze_dxf_bytes(sample_dxf, "a.dxf")
        assert "Sehnen" in result["area_method"]


class TestHonestFailures:
    def test_empty_bytes_rejected_with_german_message(self) -> None:
        with pytest.raises(DxfAnalysisError, match="Leere Datei"):
            analyze_dxf_bytes(b"", "leer.dxf")

    def test_corrupt_bytes_rejected_with_german_message(self) -> None:
        with pytest.raises(DxfAnalysisError, match="nicht lesbar"):
            analyze_dxf_bytes(b"das ist definitiv kein DXF-Dokument \x00\x01", "kaputt.dxf")


class TestRouteWiring:
    """Contrats de câblage (style §60) : lecture des sources, pas d'à-peu-près."""

    SOURCE = (REPO_ROOT / "backend/app/api/ifc_routes.py").read_text(encoding="utf-8")

    def test_dwg_rvt_removed_from_allowed_set(self) -> None:
        assert '_UNSUPPORTED_KNOWN_EXTENSIONS = {".dwg", ".rvt"}' in self.SOURCE
        assert '_ALLOWED_EXTENSIONS = {".ifc", ".ifczip", ".ifcxml", ".step", ".dxf"}' in self.SOURCE

    def test_dwg_rvt_get_explicit_conversion_guide(self) -> None:
        assert "wird derzeit nicht direkt verarbeitet" in self.SOURCE
        assert "Exportieren → IFC" in self.SOURCE or "Exportieren" in self.SOURCE

    def test_dxf_route_registered_and_rate_limited_before_read(self) -> None:
        route_idx = self.SOURCE.index('@router.post("/dxf/analyze"')
        read_idx = self.SOURCE.index("file.file.read(MAX_DXF_BYTES + 1)")
        limiter_idx = self.SOURCE.index("upload_limiter.check_and_record", route_idx)
        assert limiter_idx < read_idx  # quota AVANT lecture (§60)
        assert "MAX_DXF_BYTES" in self.SOURCE

    def test_route_module_imports_with_real_router(self) -> None:
        module = importlib.import_module("app.api.ifc_routes")
        paths = [getattr(route, "path", "") for route in module.router.routes]
        assert "/api/v5/ifc/dxf/analyze" in paths
