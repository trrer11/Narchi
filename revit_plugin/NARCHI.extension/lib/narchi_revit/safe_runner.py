"""
safe_runner · Robuste Fehlerbehandlung für das Revit-Plugin

Wrapper um runner.run_calculation() mit :
  - Detaillierten Fehlertypen (UserError vs SystemError vs BugError)
  - Validierung aller Eingaben vor Berechnung
  - Recovery-Vorschläge für jedes Fehlerszenario
  - Niemals Crash — immer eine actionable Antwort an den User
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ErrorSeverity(Enum):
    NONE = "none"           # Tout va bien
    INFO = "info"           # Information utile, calcul OK
    WARNING = "warning"     # Calcul OK mais résultat à vérifier
    USER_ERROR = "user_error"   # L'utilisateur peut corriger
    SYSTEM_ERROR = "system_error"   # Problème environnement (pas Revit, pas narchi)
    BUG = "bug"             # Vrai bug NARCHI à signaler


@dataclass
class SafeResult:
    """Résultat enveloppé avec statut + messages user-friendly."""
    success: bool
    severity: ErrorSeverity = ErrorSeverity.NONE
    ergebnis: Any = None              # NarchiErgebnis si success=True
    user_message: str = ""            # Message principal pour l'utilisateur
    technical_details: str = ""       # Détails techniques (collapsible)
    recovery_steps: List[str] = field(default_factory=list)
    warnings_collected: List[str] = field(default_factory=list)


def _validate_inputs(params: Dict[str, Any]) -> Optional[SafeResult]:
    """Validation des paramètres AVANT l'appel narchi. Retourne SafeResult d'erreur si invalide, None sinon."""

    # 1. Projektname obligatoire et non-vide
    pn = (params.get("projektname") or "").strip()
    if not pn:
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message="Der Projektname darf nicht leer sein.",
            recovery_steps=["Bitte einen aussagekräftigen Projektnamen eingeben (z.B. 'MFH Pankow LP3')."]
        )
    if len(pn) > 200:
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message="Projektname zu lang (max 200 Zeichen).",
            recovery_steps=["Bitte einen kürzeren Projektnamen verwenden."]
        )

    # 2. Gebäudeart valide
    ga = params.get("gebaeudeart", "")
    if not ga:
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message="Gebäudeart nicht ausgewählt.",
            recovery_steps=["Im Wizard die Gebäudeart wählen."],
        )

    # 3. Standard valide
    std = params.get("standard", "")
    valid_stds = ["standard_einfach", "standard_mittel", "standard_hoch"]
    if std not in valid_stds:
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message=f"Ungültiger Standard: '{std}'. Erlaubt: {', '.join(valid_stds)}",
            recovery_steps=["Im Wizard 'einfach', 'mittel' oder 'hoch' wählen."],
        )

    # 4. Bundesland 2-Buchstaben-Code
    bl = (params.get("bundesland") or "").upper()
    if not bl or len(bl) != 2:
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message=f"Ungültiger Bundesland-Code: '{bl}' (erwartet 2 Buchstaben).",
            recovery_steps=["Beispiele: BY, BW, NW, BE, HH..."],
        )

    # 5. Stichtag format check
    st = params.get("stichtag", "")
    if not st or "Q" not in st.upper() or "-" not in st:
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message=f"Ungültiger Stichtag: '{st}' (erwartet Format 'YYYY-Qn').",
            recovery_steps=["Beispiel: 2026-Q4"],
        )

    # 6. Leistungsphase 1-8
    lp = params.get("leistungsphase", 3)
    if not isinstance(lp, int) or lp < 1 or lp > 8:
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message=f"Ungültige Leistungsphase: {lp} (1-8 erlaubt).",
            recovery_steps=["LP 2 für Vorplanung, LP 3 für Entwurfsplanung, LP 6 für Vergabe."],
        )

    # 7. Mode
    mode = params.get("mode", "hybrid")
    if mode not in ("topdown", "bottomup", "hybrid"):
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message=f"Ungültiger Modus: '{mode}'.",
            recovery_steps=["topdown / bottomup / hybrid (empfohlen)"],
        )

    return None  # Tout est OK


def safe_run_calculation(doc, **params) -> SafeResult:
    """
    Führt eine Berechnung aus mit kompletter Fehlerbehandlung.
    Returns SafeResult — NIE eine Exception nach oben.
    """
    # 1. Validation der Eingaben
    error = _validate_inputs(params)
    if error:
        return error

    # 2. Vérifier le doc Revit
    if doc is None:
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message="Kein aktives Revit-Dokument geöffnet.",
            recovery_steps=["Bitte ein Revit-Projekt (.rvt) öffnen und Button erneut drücken."],
        )

    # 3. narchi importer
    try:
        from . import runner
        runner._add_narchi_to_path()
    except ImportError as e:
        return SafeResult(
            success=False, severity=ErrorSeverity.SYSTEM_ERROR,
            user_message="NARCHI-Engine kann nicht geladen werden.",
            technical_details=str(e),
            recovery_steps=[
                "Im PowerShell ausführen: pip install narchi",
                "Oder das narchi-Verzeichnis nach %APPDATA%/pyRevit/Extensions/NARCHI.extension/lib/ kopieren",
                "pyRevit neu laden (kleines Icon im pyRevit-Tab)",
            ],
        )

    # 4. Berechnung mit Exception-Behandlung
    try:
        ergebnis = runner.run_calculation(doc=doc, **params)
    except ValueError as e:
        # ValueError = problème de données (modèle vide, params absurdes)
        msg = str(e)
        if "Keine extrahierbaren Bauteile" in msg:
            return SafeResult(
                success=False, severity=ErrorSeverity.USER_ERROR,
                user_message="Im aktiven Revit-Modell wurden keine auswertbaren Bauteile gefunden.",
                recovery_steps=[
                    "Sicherstellen dass das Modell tatsächlich Bauteile enthält (nicht leer)",
                    "Vorher 'Modell validieren' ausführen für Diagnose",
                    "Bei IFC-Linked-Models : Link binden vor Berechnung",
                ],
                technical_details=msg,
            )
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message=f"Eingabefehler: {msg}",
            recovery_steps=["Bitte die Parameter im Wizard überprüfen."],
            technical_details=msg,
        )
    except FileNotFoundError as e:
        return SafeResult(
            success=False, severity=ErrorSeverity.SYSTEM_ERROR,
            user_message="Eine benötigte Datendatei fehlt.",
            technical_details=str(e),
            recovery_steps=[
                "NARCHI-Installation prüfen",
                "Verzeichnis 'data/' muss neben dem narchi-Paket existieren",
            ],
        )
    except KeyError as e:
        # Typisch wenn une gebäudeart inconnue
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message=f"Unbekannter Wert: {e}",
            recovery_steps=["Im Wizard die vorgeschlagenen Werte wählen."],
            technical_details=str(e),
        )
    except MemoryError:
        return SafeResult(
            success=False, severity=ErrorSeverity.SYSTEM_ERROR,
            user_message="Nicht genug Arbeitsspeicher für dieses Modell.",
            recovery_steps=[
                "Andere Programme schließen",
                "Revit neu starten",
                "Modell verkleinern (Detailgrad reduzieren)",
            ],
        )
    except Exception as e:
        # Vrai bug — capturer le stack trace pour rapport
        import traceback
        return SafeResult(
            success=False, severity=ErrorSeverity.BUG,
            user_message="Unerwarteter Fehler in NARCHI. Bitte als Issue melden.",
            technical_details=f"{type(e).__name__}: {e}\n\n{traceback.format_exc()}",
            recovery_steps=[
                "GitHub Issue erstellen : https://github.com/narchi-projekt/narchi/issues",
                "Folgendes anhängen : Revit-Version, NARCHI-Version, technische Details unten",
                "Bei sensiblen Modellen : Issue als 'private' markieren",
            ],
        )

    # 5. Post-validation : le résultat doit avoir des valeurs plausibles
    warnings = []
    if ergebnis.summe_netto <= 0:
        warnings.append("Summe netto = 0 € — vermutlich keine relevanten Bauteile erkannt.")
    if ergebnis.summe_netto > 1_000_000_000:
        warnings.append("Summe netto > 1 Mrd € — vermutlich Einheitenfehler im Modell (mm vs m?).")
    if ergebnis.bgf <= 0:
        warnings.append("BGF konnte nicht berechnet werden. Manuell angeben oder Modell prüfen.")

    severity = ErrorSeverity.NONE
    user_msg = "Berechnung erfolgreich abgeschlossen."
    if warnings:
        severity = ErrorSeverity.WARNING
        user_msg = "Berechnung abgeschlossen mit Plausibilitätshinweisen."

    return SafeResult(
        success=True,
        severity=severity,
        ergebnis=ergebnis,
        user_message=user_msg,
        warnings_collected=warnings + (list(ergebnis.warnungen) if ergebnis else []),
    )


def safe_export(operation_name: str, fn, *args, **kwargs) -> SafeResult:
    """
    Wrapper sécurisé pour les opérations d'export (Excel, GAEB, Audit).

    Usage :
      result = safe_export("GAEB-Export", export_gaeb_x83, ergebnis, path)
    """
    try:
        output = fn(*args, **kwargs)
        return SafeResult(
            success=True, severity=ErrorSeverity.NONE,
            ergebnis=output,
            user_message=f"{operation_name} erfolgreich.",
        )
    except PermissionError as e:
        return SafeResult(
            success=False, severity=ErrorSeverity.USER_ERROR,
            user_message=f"{operation_name}: Schreibberechtigung verweigert.",
            recovery_steps=[
                "Anderen Speicherort wählen (z.B. Desktop)",
                "Datei vorher schließen wenn bereits geöffnet (z.B. in Excel)",
                "Revit als Administrator starten",
            ],
            technical_details=str(e),
        )
    except OSError as e:
        return SafeResult(
            success=False, severity=ErrorSeverity.SYSTEM_ERROR,
            user_message=f"{operation_name}: Dateisystem-Fehler.",
            technical_details=str(e),
            recovery_steps=[
                "Verfügbaren Festplattenspeicher prüfen",
                "Antiviren-Software prüfen (falscher Positiv?)",
            ],
        )
    except Exception as e:
        import traceback
        return SafeResult(
            success=False, severity=ErrorSeverity.BUG,
            user_message=f"{operation_name} fehlgeschlagen — bitte als Issue melden.",
            technical_details=f"{type(e).__name__}: {e}\n\n{traceback.format_exc()}",
            recovery_steps=["https://github.com/narchi-projekt/narchi/issues"],
        )
