# NARCHI Workflows

## Estimation de prix — pipeline natif

L'estimation des coûts est assurée par le moteur interne NARCHI V5
(`backend/app/core/estimation/`) :

- **Métrés** : extraction IFC native (IfcOpenShell), quantités par type
  d'élément, rejet explicite des fichiers corrompus (aucun chiffre
  fabriqué à partir d'un fichier invalide).
- **Kalkulation DIN 276** : répartition KG 100–800, benchmarks par type
  de bâtiment, facteurs régionaux (Bundesländer/métropoles), indices
  Baupreisindex Destatis.
- **Sortie** : `CostEstimation` + `CostEstimationItem` en PostgreSQL,
  export Excel/PDF/JSON via l'API (`/api/v1/ifc/...`, `/api/v1/prices/...`).

Le tout sans dépendance LLM, sans convertisseur externe et sans coût d'API.

## Intégration n8n

NARCHI s'intègre à n8n par simple appel HTTP vers l'API backend
(node `HTTP Request`) :

```http
POST https://narchi.de/api/v1/ifc/compute
Content-Type: application/json
Authorization: Bearer <token>

{
  "project_id": "<uuid>",
  "gebaeudeart": "wohngebaeude_mfh",
  "standard": "mittel",
  "plz": "10115",
  "grossstadt": "Berlin"
}
```

La réponse (KG-Struktur, totaux netto/brutto, hash d'audit) peut
alimenter n'importe quel enchaînement n8n : e-mail, SharePoint, import
RIB iTWO via interface AVA, webhooks de validation d'estimation

### Points d'attention d'intégration

- `timeout` n8n ≥ 120 s pour les gros IFC (extraction + estimation).
- Le hash `audit_hash` garantit la traçabilité de chaque estimation
  (référence interne, horodatage, facteurs appliqués).
