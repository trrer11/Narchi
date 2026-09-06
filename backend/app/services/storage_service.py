"""
NARCHI V5 — S3/Cloudflare R2 Object Storage Service (SecOps Hardened).
Provides high-performance presigned POST signature generation with strict content-length constraints.
Includes HEAD object verification to authenticate physical file sizes directly from the Cloud,
eradicating any client-side spoofing vector.
"""

import os
import re
import uuid
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException, status

from app.services.quota_service import resolve_tenant_quota_limit
from app.core.logging import get_logger

logger = get_logger("storage_service")


class StorageService:
    def __init__(self):
        self.bucket_name = os.getenv("S3_BUCKET_NAME", "narchi-saas-production-files")
        self.endpoint_url = os.getenv("S3_ENDPOINT_URL")  # Cloudflare R2 / AWS S3 Endpoint
        self.access_key = os.getenv("AWS_ACCESS_KEY_ID")
        self.secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
        self.region_name = os.getenv("AWS_REGION", "eu-central-1")

        self.s3_config = Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=5,
            read_timeout=5
        )

        self.s3_client = boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            region_name=self.region_name,
            config=self.s3_config
        )

    def generate_presigned_upload_post(self, tenant_id: str, file_name: str, file_size_bytes: int = None, expires_in: int = 3600) -> dict:
        """
        Génère des paramètres et une URL pré-signée de dépôt de type POST (Secure Presigned POST).
        Impérativement sécurisé contre la triche de taille par l'en-tête 'content-length-range' :
        S3/R2 rejette matériellement tout téléversement si le fichier envoyé sort des bornes de taille.
        """
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant ID manquant.")

        safe_file_name = re.sub(
            r"[^A-Za-z0-9._-]", "_", os.path.basename(file_name)
        )[:180]
        if not safe_file_name or safe_file_name in {".", ".."}:
            raise HTTPException(status_code=400, detail="Nom de fichier invalide.")
        object_key = (
            f"tenants/{tenant_id}/files/{uuid.uuid4().hex}/{safe_file_name}"
        )

        # Résoudre la limite haute de quota d'espace disque disponible pour ce locataire
        tenant_limit = resolve_tenant_quota_limit(tenant_id)

        # Sûreté : Si la taille déclarée dépasse le quota restant, on le bloque immédiatement en périphérie
        max_allowed_upload = min(file_size_bytes, tenant_limit) if file_size_bytes else tenant_limit

        try:
            # Imposer de manière cryptographique les restrictions à S3/R2
            conditions = [
                # Taille minimale de 100 octets, taille maximale strictement confinée au quota disponible
                ["content-length-range", 100, max_allowed_upload],
                {"bucket": self.bucket_name},
                {"key": object_key}
            ]

            presigned_post = self.s3_client.generate_presigned_post(
                Bucket=self.bucket_name,
                Key=object_key,
                Fields={"Content-Type": "application/octet-stream"},
                Conditions=conditions,
                ExpiresIn=expires_in
            )

            logger.debug("Presigned upload POST generated",
                         extra={"tenant_id": tenant_id, "object_key": object_key,
                                "max_size": max_allowed_upload})

            return {
                "url": presigned_post["url"],
                "fields": presigned_post["fields"],
                "key": object_key,
                "bucket": self.bucket_name,
                "file_name": safe_file_name,
                "method": "POST"
            }
        except ClientError as e:
            logger.error("S3 presigned POST failed",
                         extra={"tenant_id": tenant_id, "error": str(e)})
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Échec de l'infrastructure cloud S3 : {e.response['Error']['Message']}"
            )

    def get_cloud_object_metadata(self, tenant_id: str, object_key: str) -> dict:
        """
        Exécute une requête S3 HEAD Object sur le stockage Cloud pour valider et certifier
        la présence physique et la taille exacte (ContentLength) du fichier effectivement écrit.
        ZÉRO CONFIANCE envers les métadonnées déclarées par le client.
        """
        tenant_prefix = f"tenants/{tenant_id}/"
        if not object_key.startswith(tenant_prefix):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Violation logique de confinement multi-tenant d'accès."
            )

        try:
            # Interroger S3/R2 à la source pour authentifier le fichier (HEAD)
            head_metadata = self.s3_client.head_object(
                Bucket=self.bucket_name,
                Key=object_key
            )
            logger.debug("Cloud object metadata retrieved",
                         extra={"tenant_id": tenant_id, "object_key": object_key,
                                "size_bytes": head_metadata["ContentLength"]})
            return {
                "size_bytes": head_metadata["ContentLength"],
                "content_type": head_metadata["ContentType"],
                "last_modified": head_metadata["LastModified"]
            }
        except ClientError as e:
            logger.warning("Cloud object HEAD failed",
                           extra={"tenant_id": tenant_id, "object_key": object_key, "error": str(e)})
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Validation d'intégrité échouée : Le modèle IFC n'existe pas sur notre stockage cloud."
            )

    def generate_presigned_download_url(self, tenant_id: str, object_key: str, expires_in: int = 3600) -> str:
        """
        Génère une URL pré-signée de téléchargement sécurisée (GET).
        Vérifie de manière étanche que la clé demandée appartient exclusivement au locataire demandeur.
        """
        if not tenant_id:
            raise HTTPException(status_code=400, detail="Tenant ID manquant.")

        tenant_prefix = f"tenants/{tenant_id}/"
        if not object_key.startswith(tenant_prefix):
            logger.warning("Multi-tenant violation detected: exfiltration attempt",
                           extra={"tenant_id": tenant_id, "object_key": object_key})
            raise HTTPException(
                status_code=403,
                detail="Autorisation refusée : Cette ressource n'appartient pas à votre espace d'agence d'architecture."
            )

        try:
            url = self.s3_client.generate_presigned_url(
                ClientMethod="get_object",
                Params={
                    "Bucket": self.bucket_name,
                    "Key": object_key
                },
                ExpiresIn=expires_in
            )
            logger.debug("Presigned download URL generated",
                         extra={"tenant_id": tenant_id, "object_key": object_key})
            return url
        except ClientError as e:
            logger.error("S3 presigned download failed",
                         extra={"tenant_id": tenant_id, "object_key": object_key, "error": str(e)})
            raise HTTPException(
                status_code=502,
                detail="Échec de l'infrastructure de streaming cloud."
            )

    def get_object_header_bytes(
        self,
        tenant_id: str,
        object_key: str,
        byte_count: int = 16,
    ) -> bytes:
        """Lit une plage minimale pour valider les magic bytes sans télécharger l'objet."""
        tenant_prefix = f"tenants/{tenant_id}/"
        if not object_key.startswith(tenant_prefix):
            raise HTTPException(status_code=403, detail="Clé objet hors tenant.")
        count = max(1, min(byte_count, 512))
        try:
            response = self.s3_client.get_object(
                Bucket=self.bucket_name,
                Key=object_key,
                Range=f"bytes=0-{count - 1}",
            )
            return response["Body"].read(count)
        except ClientError as error:
            logger.warning(
                "S3 range validation failed",
                extra={"tenant_id": tenant_id, "object_key": object_key},
            )
            raise HTTPException(
                status_code=400,
                detail="Impossible de valider la signature binaire du fichier.",
            ) from error

    def download_file(self, tenant_id: str, object_key: str, local_path: str) -> None:
        """
        Télécharge un fichier depuis S3/R2 vers un chemin local.
        Utilisé pour le parsing IFC qui nécessite un fichier local.
        """
        tenant_prefix = f"tenants/{tenant_id}/"
        if not object_key.startswith(tenant_prefix):
            raise HTTPException(
                status_code=403,
                detail="Violation multi-tenant : clé non autorisée."
            )
        try:
            self.s3_client.download_file(
                Bucket=self.bucket_name,
                Key=object_key,
                Filename=local_path
            )
            logger.info("File downloaded from cloud storage",
                        extra={"tenant_id": tenant_id, "object_key": object_key,
                               "local_path": local_path})
        except ClientError as e:
            logger.error("S3 download failed",
                         extra={"tenant_id": tenant_id, "object_key": object_key, "error": str(e)})
            raise HTTPException(
                status_code=400,
                detail="Impossible de télécharger le fichier depuis le stockage cloud."
            )


# Singleton global du service de stockage cloud
storage_service = StorageService()