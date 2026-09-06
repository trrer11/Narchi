# Distribution edge R2 des assets BIM

1. Créer le bucket `narchi-static-assets` et le domaine `assets.narchi.de`.
2. Générer les assets :
   ```bash
   cd frontend
   npm ci
   npm run copy-ifc-assets
   npm run build:vendor
   ```
3. Envoyer `frontend/public/ifc/*` sous le préfixe `ifc/` et
   `frontend/public/vendor/*` sous `vendor/` dans R2.
4. Déployer le Worker :
   ```bash
   cd infra/cloudflare
   npx wrangler deploy
   ```
5. Construire le frontend avec :
   ```env
   VITE_ASSET_BASE=https://assets.narchi.de
   VITE_IFC_WASM_BASE=https://assets.narchi.de/ifc/
   VITE_FRAGMENTS_WORKER_URL=https://assets.narchi.de/ifc/fragments-worker.mjs
   ```

Le Worker limite les chemins à `ifc/` et `vendor/`, applique un cache immutable
d'un an et renvoie les en-têtes CORS/CORP requis par les workers et iframes.
