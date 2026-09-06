"""
NARCHI V5 — Intelligence Artificielle Normative (RAG Pipeline & Unstructured)
Implémente la norme DIN 276 et DIN 18040 (Accessibilité PMR)
"""

import hashlib
import json
import os
import logging
from typing import List, Dict, Any

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.documents import Document
from langchain_postgres import PGVector
from langchain_core.prompts import ChatPromptTemplate
from langchain_community.document_loaders import UnstructuredPDFLoader

from app.config import settings
from app.services.rag_connection import build_pgvector_connection

logger = logging.getLogger("narchi.ai")

class AIAuditService:
    def __init__(self):
        # On utilise le namespace OpenAI, avec fallback/mocks si besoin
        self.embeddings = OpenAIEmbeddings(
            openai_api_key=settings.OPENAI_API_KEY or "dummy",
            model="text-embedding-3-small"
        )
        self.llm = ChatOpenAI(
            openai_api_key=settings.OPENAI_API_KEY or "dummy",
            model="gpt-4o",
            temperature=0.1
        )
        
        # §51 — Magasin vectoriel pgvector dans PostgreSQL : aucune donnée BIM
        # tenant n'est conservée en mémoire process, et les vecteurs vivent
        # dans le même périmètre sauvegardé (pgBackRest) que le reste.
        self.vector_connection = build_pgvector_connection(settings.DATABASE_URL)

    def _convert_ifc_to_documents(self, ifc_data: List[Dict[str, Any]]) -> List[Document]:
        """Convertit l'extraction géométrique de la maquette (IFC) en vecteurs sémantiques."""
        docs = []
        for element in ifc_data:
            content = f"L'élément {element.get('name', 'Inconnu')} (GUID: {element.get('globalId', 'N/A')}) " \
                      f"est de type {element.get('type', 'Inconnu')}. "
            
            bbox = element.get("bbox", [])
            if len(bbox) == 6:
                width = abs(bbox[3] - bbox[0])
                depth = abs(bbox[4] - bbox[1])
                height = abs(bbox[5] - bbox[2])
                content += f"Ses dimensions sont de {width:.2f}m (largeur) x {depth:.2f}m x {height:.2f}m. "

            meta = {
                "global_id": element.get("globalId", ""),
                "type": element.get("type", ""),
                "storey": element.get("level", "RDC"),
                "source_type": "ifc_model"
            }
            docs.append(Document(page_content=content, metadata=meta))
            
        return docs

    def _ingest_normative_documents(self, pdf_dir: str) -> List[Document]:
        """
        [PROJET ELITE : unstructured-io/unstructured]
        Ingère les documents PDF complexes (Normes DIN 18040, DIN 276, GEG 2024).
        Découpe intelligemment le PDF (tableaux, paragraphes, en-têtes) pour alimenter le RAG.
        """
        docs = []
        if not os.path.exists(pdf_dir):
            return docs
            
        for filename in os.listdir(pdf_dir):
            if filename.lower().endswith(".pdf"):
                file_path = os.path.join(pdf_dir, filename)
                try:
                    # Intégration unstructured : Mode "elements" pour isoler sémantiquement chaque bloc (table, texte)
                    loader = UnstructuredPDFLoader(
                        file_path,
                        mode="elements",
                        strategy="fast",
                    )
                    pdf_docs = loader.load()
                    for doc in pdf_docs:
                        doc.metadata["source"] = f"norm_pdf_{filename}"
                    docs.extend(pdf_docs)
                    logger.info(f"✅ Document normatif ingéré via unstructured : {filename} ({len(pdf_docs)} vecteurs)")
                except Exception as e:
                    logger.error(f"❌ Erreur unstructured sur {filename}: {e}")
        return docs

    def run_compliance_audit(
        self,
        query: str,
        ifc_data: List[Dict[str, Any]],
        tenant_id: str,
    ) -> Dict[str, Any]:
        """
        Exécute l'audit IA RAG sur le modèle, en croisant la géométrie et les normes juridiques.
        """
        cloud_ok = (
            getattr(settings, "LLM_CLOUD_ENABLED", False)
            and settings.OPENAI_API_KEY
            and settings.OPENAI_API_KEY != "dummy"
        )
        ollama = getattr(settings, "OLLAMA_BASE_URL", "") or ""
        if not cloud_ok:
            if ollama.strip():
                from app.services.ollama_client import ollama_chat

                model = getattr(settings, "LLM_MODEL", "") or "llama3.2:3b"
                snippet = json.dumps(ifc_data[:8], ensure_ascii=False)[:4000]
                prompt = (
                    "Du bist ein Assistent im Architekturbüro. Antworte auf Deutsch. "
                    "Erfinde keine Maße. Wenn die Daten fehlen, sage es. "
                    f"Frage: {query}\nAusschnitt Modell (max. 8 Elemente): {snippet}"
                )
                try:
                    text = ollama_chat(ollama.strip(), model, prompt)
                except Exception as exc:  # noqa: BLE001 — ehrlich an die UI
                    return {
                        "answer": f"Ollama lokal fehlgeschlagen ({exc}). Modell {model} geladen? (8 GB: llama3.2:3b)",
                        "sources": [],
                    }
                return {"answer": text, "sources": ["ollama-local", model]}
            return {
                "answer": (
                    "Kein KI-Audit: Cloud ist aus (LLM_CLOUD_ENABLED=false, DSGVO). "
                    "Optional Ollama im Profil docker compose --profile ollama. "
                    "Nichts wird über US-Server geschickt."
                ),
                "sources": [],
            }
            
        # 1. Pipeline de Fusion : Domain-Specific RAG
        ifc_docs = self._convert_ifc_to_documents(ifc_data)
        
        # Répertoire des normes PDF fourni par l'agence d'architecture
        norms_dir = str(settings.BASE_DIR / "storage" / "norms")
        norm_docs = self._ingest_normative_documents(norms_dir)
        
        all_docs = ifc_docs + norm_docs
        if not all_docs:
            return {
                "answer": "Aucune donnée IFC ou normative exploitable n'a été fournie.",
                "sources": [],
            }

        # Une collection nommée par tenant (hachage irréversible de l'id)
        # empêche toute recherche croisée : PGVector ne filtre que sur la
        # collection du tenant appelant.
        tenant_digest = hashlib.sha256(tenant_id.encode()).hexdigest()[:24]
        collection_name = f"ifc_hybrid_audit_{tenant_digest}"
        # Parité avec l'ancien moteur : insertion additive, jamais de purge
        # implicite (pre_delete_collection=False). Les tables langchain_pg_*
        # sont créées à la première utilisation, dans la base sauvegardée.
        vectorstore = PGVector.from_documents(
            all_docs,
            self.embeddings,
            collection_name=collection_name,
            connection=self.vector_connection,
            use_jsonb=True,
            pre_delete_collection=False,
        )
        
        # On remonte les 7 vecteurs les plus proches (ex: les portes de la maquette + le paragraphe de loi DIN 18040 sur les portes)
        retriever = vectorstore.as_retriever(search_kwargs={"k": 7})

        # 3. Pipeline d'Expertise Normative
        system_prompt = (
            "Tu es un Expert Architecte et Auditeur BIM allemand, spécialisé dans les normes "
            "DIN 276 (Coûts) et DIN 18040-2 (Accessibilité PMR). "
            "Tu as accès à deux sources de données dans le contexte : "
            "1. La géométrie exacte de la maquette (portes, murs, dimensions).\n"
            "2. Les textes de loi extraits directement des PDF de normes.\n"
            "Analyse la maquette et vérifie sa conformité. Si un élément géométrique viole le texte de loi, signale-le.\n\n"
            "Contexte:\n{context}"
        )
        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "{input}")
        ])

        # 4. LCEL explicite (LangChain 1.x) : récupération puis invocation LLM.
        context_docs = retriever.invoke(query)
        context_text = "\n\n".join(document.page_content for document in context_docs)
        messages = prompt.invoke({"input": query, "context": context_text})
        response = self.llm.invoke(messages)
        answer = response.content if isinstance(response.content, str) else str(response.content)

        sources = [
            document.metadata.get("global_id") or document.metadata.get("source")
            for document in context_docs
        ]
        return {
            "answer": answer,
            "sources": sorted({source for source in sources if source}),
        }

ai_audit_service = AIAuditService()
