# Analyse détaillée NARCHI — 25 août 2026

Document **mesuré dans le dépôt** (HEAD `95983b8`).  
`ARCHITECTURE.md` (juillet 2026) est **partiellement obsolète** : il parle encore d’API v1, JWT 15 min, replica Postgres. Le produit vivant est décrit ici.

---

## 1. Qu’est-ce que NARCHI ?

Plateforme **self-host** pour **bureaux d’architecture allemands** (KMU).  
Promesse tenue quand les données existent : **IFC dans le navigateur → quantités → DIN 276 → HOAI / GEG / clash / facture XRechnung**.

Ce n’est **pas** un ERP complet, **pas** Navisworks, **pas** un réseau Peppol.  
C’est un **cockpit bureau** : un tenant = un bureau, plusieurs projets, sync entre PC du même bureau.

---

## 2. Ce qu’il fait vraiment (par métier)

| Domaine | Ce qui existe | Limite honnête |
|---|---|---|
| **IFC / BIM** | Parse client (web-ifc + worker) + serveur (ifcopenshell). DXF via ezdxf. 3D That Open / Three.js. | DWG/RVT **refusés**. Pas d’édition IFC. |
| **DIN 276** | Schätzung paramétrique + pont depuis NGF IfcSpace. GAEB X31. | Kennwerte = **Richtwert**, pas offre. |
| **HOAI** | Tafel orientation, LP, Nachtrag, Stunden, Abschlag → brouillon facture. | 2021 = **freie Vereinbarung**. 0 € anrechenbar = pas d’invention. |
| **GEG** | Monatsbilanz simplifiée DIN V 18599. | TFA 0 = pas de statut inventé. |
| **Clash** | BBox IFC, filtre Anschluss, Befundgruppen, focus 3D. | Pas de collision triangle-exacte type Solibri. Sans bbox = vide. |
| **Baustelle** | Import photos/vidéos bureau, EXIF, Mängel, sync. | Pas de bot WhatsApp. Téléphone officiel abandonné (§206). |
| **E-Rechnung** | GoBD, XRechnung CII, ZUGFeRD PDF/A-3, UBL, .eml. | Peppol réseau **différé**. Impressum/IBAN = saisie humaine. |
| **Collab** | Chat WS, CRDT (Yjs + pycrdt), présence. | — |
| **IQ** | RAG / OpenAI **si clé serveur**. | Sans clé = pas de magie. |
| **Prix** | Bibliothèque bureau, Destatis, Spiegel d’offres. | Pas de BKI licencié embarqué. |

---

## 3. Technologie (stack réelle)

```
Navigateur (Edge)  →  nginx :8080  →  SPA React
                                 ↘  FastAPI /api/v5
                                      ├ PostgreSQL 16 + pgvector + pgBouncer
                                      ├ Redis (cache, rate-limit, pub/sub, Celery)
                                      └ Celery worker (IFC lourd, PDF)
```

### Frontend
- **React 19**, **Vite 7**, **TypeScript 5.9**, **Tailwind 4**
- **Zustand** (état projet / DIN / HOAI / GEG)
- **TanStack Query**
- **Three.js 0.185** + **@thatopen/components + fragments 3.4.6** + **web-ifc**
- **Yjs** (co-édition)
- **jspdf** (rapports)
- i18next encore en deps, **UI figée DE** (§224)

### Backend
- **FastAPI 0.139** + Gunicorn/Uvicorn, **Pydantic v2**
- **SQLAlchemy 2** + **Alembic** (tête `20260823_20`)
- **Argon2id**, session **cookie HttpOnly** (`Secure` seulement en HTTPS)
- **ifcopenshell 0.8.5**, **ezdxf 1.4.4**
- **Celery 5.6** + **Redis 6**
- **LangChain + OpenAI + pgvector** (IQ)
- **Stripe** (SaaS optionnel)
- Facture : constructeur CII maison, Mustang/KoSIT **hors image** (scripts)

### Infra client
- **Docker Compose** : db, pgbouncer, redis, migrate, backend, worker, nginx
- Scripts Windows `1_` … `9_` (ASCII + CRLF)
- Sauvegardes visibles `sauvegardes\` (pg_dump + fichiers)

---

## 4. Requirements

### Machine bureau (ce que vous avez)
| Besoin | Minimum réaliste |
|---|---|
| OS | Windows 10/11 + **Docker Desktop** (WSL2) |
| Navigateur | **Edge** (Chrome aussi ; E2E mesuré Chromium) |
| RAM | **16 Go** confortable (stack ~6–8 Go : PG 2G + backend 2G + worker 4G théoriques) |
| Disque | **20 Go+** images + volumes IFC/médias |
| Réseau | `http://localhost:8080` suffit. HTTPS local = scripts `8_`/`9_` optionnels |
| Compte | Inscription = **trial tenant**. Pas besoin d’internet après images tirées |

### Secrets / .env (obligatoires au compose)
- `SECRET_KEY`, `LEGACY_SHA256_SALT`, `POSTGRES_PASSWORD`
- Optionnels : `OPENAI_API_KEY`, Stripe, Sentry, SMTP

### Développeur / sandbox
- Node 22 + `npm ci` (frontend)
- Python 3.12 + `requirements-api.txt` / `requirements.txt`
- Playwright **1.61.1** exact pour E2E Docker
- Alembic tête `20260823_20`

### Ce qui n’est **pas** requis
- Pas de téléphone, pas de bot Telegram
- Pas de Java chez le client (Mustang = script de preuve, pas le runtime bureau)
- Pas de serveur cloud (self-host)

---

## 5. Dépendances notables (versions épinglées)

**Python API :** FastAPI 0.139, SQLAlchemy 2.0.51, Alembic 1.18, Argon2 25.1, ifcopenshell 0.8.5, ezdxf 1.4.4, Celery 5.6.3, Redis 6.4, LangChain 1.3, OpenAI 2.45, Stripe 15.3, reportlab 5, pillow 12.3, pypdf 6.16.

**JS :** React 19.2, Vite 7.3, Zustand 5, Three 0.185, That Open 3.4.6, web-ifc 0.0.77, Yjs 13.6, Playwright 1.61.1, Vitest 3.2.

**Présents mais peu / plus utilisés comme avant :** `@supabase/supabase-js` (pas le runtime self-host), `i18next-browser-languagedetector` (désactivé).

---

## 6. Qualité / preuves

| Gate | Dernier état dit |
|---|---|
| pytest | 592 écrits — **non rejoués** dans ce sandbox |
| vitest | 797 écrits — non rejoués |
| E2E | **5/5, 33,8 s chez vous** (auth, 2 PC, photo, offline, IFC) |
| KoSIT / Mustang | Scripts + fixtures — mesurés historiquement, pas aujourd’hui |

---

## 7. Ce que NARCHI n’est pas

- Pas un jumeau Solibri (clash = AABB, pas mesh exact)
- Pas DATEV / DATEV-connect
- Pas Peppol Access Point
- Pas un calculateur HOAI juridiquement contraignant
- Pas un remplissage automatique Impressum / USt-IdNr / IBAN

---

## 8. Pour un autre bureau qui installe

1. Docker Desktop + dézipper le repo  
2. `1_DEMARRER_NARCHI.bat` (premier build long)  
3. Edge → `http://localhost:8080` → s’inscrire  
4. Remplir **Impressum + Absender + Anschrift Auftraggeber**  
5. IFC → Speichern → DIN / Clash / HOAI  
6. Sauvegardes : `5_SAUVEGARDE_EXTERNE.bat` — **jamais** `4_TOUT_EFFACER` en prod

---

*Analyse factuelle. Les chiffres de tests non relancés ici ne sont pas présentés comme frais.*
