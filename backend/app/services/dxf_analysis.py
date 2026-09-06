"""Analyse DXF 2D RÉELLE (ezdxf) — §67 (Vague 1, honnêteté formats).

Contexte : le backend acceptait historiquement .dwg/.dxf/.rvt mais ne
parsait que .ifc/.step — la carte d'accueil promettait « IFC/DWG
hochladen » et ne livrait rien. Désormais :
  - .dxf  → analysé ici (ezdxf, dépendance déjà déclarée) ;
  - .dwg/.rvt → refusés avec un guide de conversion explicite (route).

Doctrine §36 « kein Preis ohne Herkunft », appliquée aux MESURES :
toutes les valeurs renvoyées sont comptées/mesurées dans le fichier.
Ce qui n'est pas déterminable est omis ou explicitement marqué
(area_method documente l'approximation des bulges de polylignes).

Aucune écriture disque permanente : l'analyse utilise un fichier
temporaire supprimé en `finally`.
"""

from __future__ import annotations

import io
import os
import tempfile
from dataclasses import dataclass, field

import ezdxf

MAX_DXF_BYTES = 25 * 1024 * 1024  # 25 Mo — garde-fou mémoire/temps (route)

# Types d'entités 2D pertinents pour un plan (comptage exhaustif par type,
# la route plafonne l'affichage — le service renvoie tout).
_TRACKED_ENTITY_TYPES = {
    "LINE",
    "LWPOLYLINE",
    "POLYLINE",
    "CIRCLE",
    "ARC",
    "ELLIPSE",
    "SPLINE",
    "TEXT",
    "MTEXT",
    "INSERT",
    "HATCH",
    "DIMENSION",
    "POINT",
    "SOLID",
    "LEADER",
    "MLINE",
}


class DxfAnalysisError(ValueError):
    """Fichier DXF illisible/corrompu — message déjà en allemand pour l'UI."""


@dataclass
class LayerStat:
    name: str
    entity_count: int = 0
    closed_polyline_area: float = 0.0


@dataclass
class _Accumulators:
    layers: dict[str, LayerStat] = field(default_factory=dict)
    entity_counts: dict[str, int] = field(default_factory=dict)
    block_reference_count: int = 0
    text_entity_count: int = 0

    def layer(self, name: str) -> LayerStat:
        if name not in self.layers:
            self.layers[name] = LayerStat(name=name)
        return self.layers[name]


def _polygon_chord_area(points: list[tuple[float, float]]) -> float:
    """Aire signée du polygone (lacets).

    NB honnêteté : les segments courbes (bulge DXF) sont approximés par
    leur corde — signalé via `area_method` dans la réponse.
    """
    area = 0.0
    count = len(points)
    for index in range(count):
        x1, y1 = points[index]
        x2, y2 = points[(index + 1) % count]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def _lwpolyline_vertices(entity) -> list[tuple[float, float]]:
    return [(float(v[0]), float(v[1])) for v in entity.get_points("xy")]


def _polyline_vertices(entity) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for vertex in entity.vertices:
        location = vertex.dxf.location
        points.append((float(location.x), float(location.y)))
    return points


def _accumulate_entity(accumulators: _Accumulators, entity, units_factor: float) -> None:
    dxftype = entity.dxftype()
    if dxftype in _TRACKED_ENTITY_TYPES:
        accumulators.entity_counts[dxftype] = accumulators.entity_counts.get(dxftype, 0) + 1
    else:
        accumulators.entity_counts[dxftype] = accumulators.entity_counts.get(dxftype, 0) + 1  # exhaustif

    layer_name = getattr(entity.dxf, "layer", "0") or "0"
    layer = accumulators.layer(layer_name)
    layer.entity_count += 1

    if dxftype == "INSERT":
        accumulators.block_reference_count += 1
    if dxftype in {"TEXT", "MTEXT"}:
        accumulators.text_entity_count += 1

    closed_pts: list[tuple[float, float]] | None = None
    if dxftype == "LWPOLYLINE" and getattr(entity, "closed", False):
        closed_pts = _lwpolyline_vertices(entity)
    elif dxftype == "POLYLINE" and entity.is_closed:
        closed_pts = _polyline_vertices(entity)
    if closed_pts and len(closed_pts) >= 3:
        layer.closed_polyline_area += _polygon_chord_area(closed_pts) * (units_factor**2)


def _units_metadata(doc) -> tuple[str, float]:
    """Nom d'unité DXF + facteur vers le mètre (1.0 si inconnu → m² bruts).

    $INSUNITS : 0=sans unité, 1=pouces, 4=mm, 5=cm, 6=m…
    """
    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    table = {
        1: ("Zoll (in)", 0.0254),
        2: ("Fuß (ft)", 0.3048),
        4: ("Millimeter (mm)", 0.001),
        5: ("Zentimeter (cm)", 0.01),
        6: ("Meter (m)", 1.0),
        7: ("Kilometer (km)", 1000.0),
    }
    if insunits in table:
        return table[insunits]
    return ("keine Einheit gesetzt", 1.0)


def analyze_dxf_bytes(data: bytes, filename: str) -> dict:
    """Analyse réelle d'un DXF (bytes) → dict prêt pour le schéma réponse.

    Lève DxfAnalysisError (message allemand) si le fichier est illisible.
    """
    if not data:
        raise DxfAnalysisError("Leere Datei — der Upload enthält keine Daten.")

    # ezdxf lit le plus simplement via un fichier (ASCII ou binaire) :
    # tampon temporaire, TOUJOURS supprimé.
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            doc = ezdxf.readfile(tmp_path)
        except Exception:
            # recover est plus tolérant (fichiers partiellement corrompus) ;
            # s'il échoue aussi, le message honnête part au client.
            try:
                doc, _auditor = ezdxf.recover.readfile(tmp_path)
            except Exception as exc:  # noqa: BLE001 — message honnête §36
                raise DxfAnalysisError(
                    "DXF-Datei nicht lesbar oder beschädigt — bitte aus dem CAD "
                    "erneut als DXF (ASCII) exportieren."
                ) from exc

        msp = doc.modelspace()
        units_name, units_factor = _units_metadata(doc)
        accumulators = _Accumulators()
        for entity in msp:
            try:
                _accumulate_entity(accumulators, entity, units_factor)
            except Exception:
                # Une entité exotique ne doit jamais faire échouer l'analyse
                # globale — elle est simplement ignorée du détail.
                continue

        layer_stats = sorted(
            (
                {
                    "name": layer.name,
                    "entity_count": layer.entity_count,
                    "closed_polyline_area": round(layer.closed_polyline_area, 3),
                }
                for layer in accumulators.layers.values()
            ),
            key=lambda item: item["entity_count"],
            reverse=True,
        )
        block_definitions = max(0, len([b for b in doc.blocks if not b.name.startswith("*")]))

        total_area = round(sum(item["closed_polyline_area"] for item in layer_stats), 3)
        return {
            "filename": filename,
            "dxf_version": str(doc.dxfversion or "unbekannt"),
            "units": units_name,
            "entity_total": sum(accumulators.entity_counts.values()),
            "entity_counts": dict(
                sorted(accumulators.entity_counts.items(), key=lambda kv: kv[1], reverse=True)
            ),
            "layer_count": len(layer_stats),
            "layers": layer_stats,
            "block_definition_count": block_definitions,
            "block_reference_count": accumulators.block_reference_count,
            "text_entity_count": accumulators.text_entity_count,
            "closed_polyline_area_total": total_area,
            "area_method": "Polygon-Sehnen (Bulges als Sehne angenähert) — Messung aus dem Modellraum",
            "analysis_kind": "dxf_2d",
        }
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
