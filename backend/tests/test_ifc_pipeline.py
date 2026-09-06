from pathlib import Path

from app.core.ifc_pipeline import extract_ifc_metadata


def test_real_ifc_sample_is_parsed_without_size_heuristic():
    sample = Path(__file__).resolve().parents[2] / "examples" / "simple_house_efh.ifc"
    metadata = extract_ifc_metadata(sample, sample.name)
    assert metadata["schema_version"].upper().startswith("IFC")
    assert metadata["element_count"] > 0
    assert metadata["storey_count"] >= 1
    assert metadata["bgf"] > 0


def test_corrupt_ifc_is_rejected(tmp_path):
    corrupt = tmp_path / "corrupt.ifc"
    corrupt.write_text("not an IFC", encoding="utf-8")
    try:
        extract_ifc_metadata(corrupt, corrupt.name)
    except ValueError as error:
        assert "corrompu" in str(error)
    else:
        raise AssertionError("Un IFC corrompu ne doit jamais produire une estimation")
