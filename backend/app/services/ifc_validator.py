"""
NARCHI V5 — Secure IFC Header Validation Service.
Inspects STEP ISO-10303-21 structure in streaming mode without loading complete files into memory,
effectively mitigating low-level C++ engine buffer overflow attack vectors.
"""

import io
import re
from typing import BinaryIO, Set
from fastapi import HTTPException

class InvalidIFCSchemaException(Exception):
    """Exception raised when an uploaded model violates ISO-10303-21 or official buildingSMART schemas."""
    pass

# Liste blanche officielle et certifiée des schémas d'échanges IFC du consortium buildingSMART
ALLOWED_SCHEMAS: Set[str] = {
    "IFC2X", "IFC2X2", "IFC2X3", "IFC2X_PLATFORM",
    "IFC4", "IFC4X1", "IFC4X2",
    "IFC4X3", "IFC4X3_RC1", "IFC4X3_RC2", "IFC4X3_RC3", "IFC4X3_RC4",
    "IFC4X3_ADD1", "IFC4X3_ADD2",
}

def validate_ifc_header_stream(file_stream: BinaryIO, chunk_size: int = 65536, max_scan_bytes: int = 1048576) -> str:
    """
    Analyses and validates the structural header of an IFC file in a highly secure streaming fashion.
    Reads chunk-by-chunk (default 64 KB) up to a hard ceiling of 1 MB to prevent memory exhaustion (OOM DoS).
    
    Returns the extracted official schema version name if validated.
    Raises InvalidIFCSchemaException if any check fails.
    """
    buffer = ""
    bytes_scanned = 0
    
    # 1. Lecture progressive par morceaux pour éliminer tout risque d'épuisement de la RAM
    while bytes_scanned < max_scan_bytes:
        chunk = file_stream.read(chunk_size)
        if not chunk:
            break
            
        bytes_scanned += len(chunk)
        # Décodage robuste en ignorant les éventuels octets non-UTF8 (norme STEP autorisant divers encodages)
        buffer += chunk.decode("utf-8", errors="ignore")
        
        # Fin de la section HEADER d'un fichier STEP standardisé
        if "ENDSEC;" in buffer:
            break

    # 2. Validation de la signature d'en-tête du format STEP ISO-10303-21
    trimmed_buffer = buffer.strip()
    if not trimmed_buffer.startswith("ISO-10303-21;"):
        raise InvalidIFCSchemaException(
            "Signature de format invalide : Le fichier ne commence pas par l'en-tête standard 'ISO-10303-21;'. "
            "Contournement d'extension ou fichier hostile détecté."
        )

    if "HEADER;" not in trimmed_buffer:
        raise InvalidIFCSchemaException(
            "Structure STEP invalide : Section 'HEADER;' introuvable. "
            "Le fichier est corrompu ou malicieusement altéré."
        )

    # 3. Extraction chirurgicale par expression régulière de l'attribut FILE_SCHEMA
    # Ex: FILE_SCHEMA(('IFC2X3')); ou FILE_SCHEMA ( ( 'IFC4' ) ) ;
    schema_pattern = re.compile(
        r"FILE_SCHEMA\s*\(\s*\(\s*\'([A-Za-z0-9_]+)\'\s*\)\s*\)\s*;", 
        re.IGNORECASE
    )
    match = schema_pattern.search(trimmed_buffer)
    
    if not match:
        raise InvalidIFCSchemaException(
            "Contrôle de métadonnées échoué : Attribut 'FILE_SCHEMA' introuvable dans la section HEADER. "
            "Impossible d'attester l'origine de la maquette."
        )

    schema_name = match.group(1).upper()
    
    # 4. Confrontation par rapport à la liste blanche des schémas d'échanges certifiés
    if schema_name not in ALLOWED_SCHEMAS:
        raise InvalidIFCSchemaException(
            f"Schéma d'échange non autorisé : '{schema_name}' ne fait pas partie des schémas "
            f"buildingSMART officiellement reconnus ({', '.join(sorted(ALLOWED_SCHEMAS))})."
        )

    return schema_name
