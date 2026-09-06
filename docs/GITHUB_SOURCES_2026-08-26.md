# GitHub-Quellen geprüft (26.08.2026)

Salle blanche : **licence lue**, rien copié d’AGPL. Idée seulement.

| Dépôt | Licence | Pour NARCHI |
|---|---|---|
| [itplr-kosit/validator](https://github.com/itplr-kosit/validator) | Apache-2.0 | **Déjà** sidecar §260 |
| [ZUGFeRD/mustangproject](https://github.com/ZUGFeRD/mustangproject) | Apache-2.0 | **Déjà** scripts ZUGFeRD |
| [buildingSMART-Romania/ifcescu-app](https://github.com/buildingSMART-Romania/ifcescu-app) | **MPL-2.0** | Idée : clearance AABB + (plus tard) Möller mesh. **Pas de code copié** (MPL file-level). |
| [LTplus-AG/ifc-lite](https://github.com/LTplus-AG/ifc-lite) | à relire avant npm | WebGPU/WASM — **pas** embarqué (That Open déjà là) |
| [drbrnn/XFakturist](https://github.com/drbrnn/XFakturist) | **AGPL-3.0** | **Interdit** (doctrine §114) |
| [automationsmanufaktur-labs/open-invoice-germany](https://github.com/automationsmanufaktur-labs/open-invoice-germany) | **AGPL-3.0** | **Interdit** |
| [flexness/xrechnung-validator-docker](https://github.com/flexness/xrechnung-validator-docker) | Apache-2.0 | Même idée que notre `infra/kosit` — pas besoin d’ajouter |

## §272 livré à partir d’IFCescu (idée, pas de source)

Clash **clearance** : distance AABB TGA×Tragwerk ≤ 50 mm. Toujours **AABB**, pas mesh.
Mesh triangle-triangle (Möller) = 2027, dès que NARCHI a des triangles IFC.

KoSIT / Mustang restent les seules dépendances e-facture officielles.

## §273 — pyGAEB (MIT)

[frameIQ/pygaeb](https://github.com/frameIQ/pygaeb) — MIT. **Pas de dépendance pip**, pas de code copié.

Idées salle blanche déjà chez nous, durcies :
- ENTITY/DTD **partout** dans le fichier (pas seulement 2 Ko de tête)
- `DP` manquant **pas** inventé en « 31 »
- Version DA lue depuis le namensraum / `GAEBInfo` (`da_version`)

## §275 — Agent-Reach : **non** dans NARCHI

[Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach) (MIT, CLI scrape Twitter/Reddit/YouTube/GitHub, cookies locaux, contournement d’API).

**Ne pas embarquer.** NARCHI = bureau d’archi self-host (IFC, DIN 276, HOAI, XRechnung).  
Agent-Reach = recherche web pour un agent IA. Risques : CGU des plateformes, DSGVO (cookies), données hors métier, `LLM_CLOUD` déjà **off**.

Données NARCHI : IFC, Destatis (dl-de/by-2-0 déjà cité), Preisbibliothek, GAEB du bureau — pas X/Reddit.
