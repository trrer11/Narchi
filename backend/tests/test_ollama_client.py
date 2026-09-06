from app.services.ollama_client import DEFAULT_16G_MODEL, DEFAULT_SMALL_MODEL, llm_runtime_status


def test_kleine_modelle_fuer_8_und_16_gb():
    assert "3b" in DEFAULT_SMALL_MODEL
    assert "8b" in DEFAULT_16G_MODEL


def test_default_llm_ist_aus():
    st = llm_runtime_status()
    assert st["mode"] in {"off", "ollama", "cloud"}
