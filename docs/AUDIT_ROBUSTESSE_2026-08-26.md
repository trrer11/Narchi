# Audit robustesse NARCHI — 26/08/2026

**Pas un certificat.** Chaque module : usage bureau réel / limite / risque.

Légende : **Bureau** = prêt beta encadrée · **Fragile** = marche mais piège · **Mince** = pas niveau Kammer · **Théâtre** = hors menu ou à ne pas vendre.

## Cœur métier

| Module | État | Note |
|---|---|---|
| IFC import + 3D | Bureau | WASM local. Gros modèles : patience. DWG/RVT refusés (dit). |
| DIN 276 | Bureau | Charte Herkunft. NGF=0 → pas de devis inventé. |
| Preisbibliothek / GAEB | Bureau | X31/X83. EP 0,00 € jamais inventé. |
| HOAI | Bureau | `calcHoai`. 0 € anrechenbar = garde interne — UI doit le dire. Deux livres d’heures : ne pas fusionner. |
| GEG / VE-Studio | Bureau | U-Wert absent = n.a. Substitutions Ökobaudat/BKI. |
| Planprüfung clash | Bureau | AABB, pas mesh. Protokoll PDF + BCF 2.1. |
| Qualität | Bureau | Même radar + import BCF. |
| IDS | Bureau | pass/fail/n.a. Export BCF fails only §263. |
| Rechnungen | Bureau | GoBD. KoSIT CII+UBL si sidecar. Stammdaten serveur §265. |
| Baustelle | Bureau | Import bureau, EXIF, sync. Pas téléphone officiel. |
| Chat / CRDT / Team | Bureau | Tenant cloisonné. |
| Synchro Mängel/projets/médias | Bureau | Offline queue honnête. |

## Fragile (corrigé ou à surveiller)

| Module | Problème | §266 |
|---|---|---|
| Konformität (page) | `score = pass/length` → **NaN** si liste vide (= 100 % fantôme) | Score 0 + texte « keine Regeln » |
| Einstellungen Quellen | Liste vide sans mot | Phrase honnête |
| Synchronisierung | « Quellen » vides = air | Dit : pas de cloud démo |
| Digital Twin | Pas de projet / pas de capteurs | Sous-titre honnête |
| Crew Agents | Nom marketing | Menu **Prüf-Crew** (moteurs clash/audit réels) |
| ErrorBoundary | Présent | Données intactes ; Sentry optionnel |

## Mince / ne pas vendre comme Solibri

- Clash = bounding box.
- Haftungsradar : Merkblatt + audit si mesurable ; Fluchtwege pas auto.
- Peppol **réseau** : non.
- KoSIT live : seulement profil `kosit` + JAR.
- Absender : désormais serveur ; facture = snapshot.

## Théâtre / hors nav principal

`twin`, `plot`, `physics`, `vault`, `backend` (Supabase), `roadmap`, `compliance` : joignables par URL/palette. Ne pas les présenter comme le produit. Backend Supabase = `<details>` historique.

## Ce qu’on ne peut pas « rendre parfait » ici

Manifold mesh, WebGPU, Speckle, EnergyPlus, SAM2, Peppol AP, avocat AGB. Dit dans `ROADMAP_NARCHI_2027.md`.

## Relève

README §0 + ce fichier. Un module « parfait » = mesurable ou **dit incomplet**.
