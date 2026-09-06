#!/usr/bin/env python3
"""§124 — PoC mesuré : NOTRE StorageService contre floci (émulateur AWS local).

Rejoue la preuve de `docs/OUTIL_FLOCI_S3.md` : 7 vérifications d'interop entre
le chemin S3 réel de Narchi (POST pré-signé + content-length-range, HEAD,
GET pré-signé, confinement locataire) et floci.

Prérequis (DITS, hors gates produit) :
  1. floci qui écoute sur :4566 —
       docker run --rm -p 4566:4566 floci/floci:1.6.0
     ou  java -jar floci-1.6.0-runner.jar   (build : JDK 25 + ./mvnw package)
  2. Les dépendances backend installées (boto3, httpx).
Usage :  python3 scripts/poc-floci-s3.py
Sortie : 0 si les 7 vérifications passent, 1 sinon (cause affichée).

Ce script N'EST PAS un gate §123 : il exige Java ou Docker et ne tourne ni
dans pytest, ni sur les machines clientes (cadrage §90 : outil de dev/CI).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
FLOCI = os.environ.get("FLOCI_ENDPOINT", "http://127.0.0.1:4566")
BUCKET = os.environ.get("S3_BUCKET_NAME", "narchi-poc-floci")
TENANT = "tenant-poc-floci"

os.environ.update({
    "S3_ENDPOINT_URL": FLOCI,
    "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", "test"),
    "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", "test"),
    "AWS_REGION": os.environ.get("AWS_REGION", "eu-central-1"),
    "S3_BUCKET_NAME": BUCKET,
})
sys.path.insert(0, str(REPO / "backend"))

import httpx  # noqa: E402
import boto3  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402

from app.services.storage_service import StorageService  # noqa: E402


def main() -> int:
    mesures: list[str] = []

    s3 = boto3.client(
        "s3",
        endpoint_url=FLOCI,
        aws_access_key_id="test",
        aws_secret_access_key="test",
        region_name="eu-central-1",
    )
    try:
        s3.create_bucket(Bucket=BUCKET)
        mesures.append("create_bucket : créé")
    except ClientError as e:
        if e.response["Error"]["Code"] in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
            mesures.append(f"create_bucket : déjà présent ({e.response['Error']['Code']})")
        else:
            raise

    svc = StorageService()  # la vraie classe produit, inchangée

    # Chemin nominal : presign -> dépôt 128 Ko -> HEAD -> GET, tout par NOTRE code.
    data = bytes((i * 7 + 13) % 256 for i in range(128 * 1024))
    presign = svc.generate_presigned_upload_post(TENANT, "Mängelfoto 07.jpg", file_size_bytes=len(data))
    rep = httpx.post(
        presign["url"],
        data=presign["fields"],
        files={"file": ("mangelfoto.jpg", data, "application/octet-stream")},
        timeout=30,
    )
    if rep.status_code not in (200, 201, 204):
        mesures.append(f"ÉCHEC dépôt policy : HTTP {rep.status_code} — {rep.text[:200]}")
        _verdict(mesures)
        return 1
    mesures.append(f"dépôt POST policy (128 Ko exacts) : HTTP {rep.status_code}")

    meta = svc.get_cloud_object_metadata(TENANT, presign["key"])
    if meta["size_bytes"] != len(data):
        mesures.append(f"ÉCHEC HEAD : size_bytes={meta['size_bytes']} ≠ {len(data)}")
        _verdict(mesures)
        return 1
    mesures.append(f"HEAD via notre service : size_bytes={meta['size_bytes']} exact")

    lu = httpx.get(svc.generate_presigned_download_url(TENANT, presign["key"]), timeout=30).content
    if lu != data:
        mesures.append("ÉCHEC téléchargement : octets relus ≠ octets envoyés")
        _verdict(mesures)
        return 1
    mesures.append("GET via notre URL pré-signée : octets identiques")

    # Gardes anti-triche : le serveur (floci) doit appliquer la policy signée.
    p2 = svc.generate_presigned_upload_post(TENANT, "triche.jpg", file_size_bytes=1000)
    r2 = httpx.post(p2["url"], data=p2["fields"],
                    files={"file": ("t.jpg", b"x" * 5000, "application/octet-stream")}, timeout=30)
    if r2.status_code < 400:
        mesures.append(f"ÉCHEC garde taille haute : 5000>1000 ACCEPTÉ (HTTP {r2.status_code})")
        _verdict(mesures)
        return 1
    mesures.append(f"triche 5 000 > 1 000 signés : HTTP {r2.status_code} refusé")

    p3 = svc.generate_presigned_upload_post(TENANT, "mini.bin", file_size_bytes=10)
    r3 = httpx.post(p3["url"], data=p3["fields"],
                    files={"file": ("m.bin", b"1234567890", "application/octet-stream")}, timeout=30)
    if r3.status_code < 400:
        mesures.append(f"ÉCHEC garde plancher : 10<100 ACCEPTÉ (HTTP {r3.status_code})")
        _verdict(mesures)
        return 1
    mesures.append(f"10 octets < plancher 100 : HTTP {r3.status_code} refusé")

    # Confinement multi-locataire : notre service refuse avant tout appel réseau.
    try:
        svc.get_cloud_object_metadata(TENANT, "tenants/AUTRE-locataire/x")
        mesures.append("ÉCHEC fuite cross-locataire : NON refusée")
        _verdict(mesures)
        return 1
    except Exception as e:  # HTTPException 403 attendue
        mesures.append(f"fuite cross-locataire : refusée ({type(e).__name__} {getattr(e, 'status_code', '')})")

    _verdict(mesures)
    return 0


def _verdict(mesures: list[str]) -> None:
    print("\n=== PoC floci ↔ Narchi StorageService ===")
    for m in mesures:
        print(" •", m)


if __name__ == "__main__":
    sys.exit(main())
