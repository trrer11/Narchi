# ============================================================================
# NARCHI — CORPS COMMUN des blocs serveur 8080 (HTTP local historique) et
# 8443 (HTTPS local §119, template infra/tls/https-8443.conf).
# Extrait de nginx.conf au §119 : UNE SEULE source de verite — un correctif
# de securite s'applique aux deux ports, impossible de diverger.
# Inclus au niveau server{} : ne contient QUE des directives de ce contexte.
# ============================================================================
    # Image nginxinc/nginx-unprivileged : processus non-root (UID 101),
    # impossible de binder un port < 1024 → écoutes sur 8080 (HTTP) et,
    # si l'étape 4 est activée, 8443 (HTTPS local — §119).

    # ------------------------------------------------------------------
    # DURCISSEMENT DE BASE
    # ------------------------------------------------------------------
    server_tokens off;                    # masque la version nginx
    client_max_body_size 500m;            # uploads IFC lourds
    client_body_timeout 300s;

    root /usr/share/nginx/html;
    index index.html;

    # Compression (les .wasm web-ifc pèsent plusieurs Mo)
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript
               application/wasm text/xml application/xml text/javascript
               image/svg+xml;

    # ------------------------------------------------------------------
    # EN-TÊTES DE SÉCURITÉ GLOBAUX
    # NOTE nginx : tout add_header dans un location{} annule l'héritage —
    # le bloc complet est donc répété dans chaque location qui ajoute ses
    # propres en-têtes (Cache-Control).
    # ------------------------------------------------------------------

    # CSP ULTRA-STRICTE — adaptée à l'architecture réelle :
    #  · default-src 'none'        : tout est interdit par défaut (deny-all)
    #  · script-src 'self'         : AUCUN script inline (bundle Vite vérifié
    #    sans inline par la CI), aucun CDN
    #  · 'wasm-unsafe-eval'        : requis pour instancier les runtimes WASM
    #    locaux de web-ifc (/ifc/*.wasm) — n'autorise PAS eval() JS
    #  · worker-src 'self' blob:   : Workers bundlés Vite (ifcParser, bcfParser)
    #  · connect-src 'self' blob: https://assets.narchi.de + wss://$host : API et WebSocket STRICTEMENT
    #    same-origin — toute exfiltration vers un domaine tiers est bloquée
    #  · style-src 'unsafe-inline' : styles inline React (style={}) — sans
    #    exécution possible de script ; les feuilles restent same-origin
    #  · img-src data: blob:       : textures/thumbnails générés (canvas, KTX2)
    #  · frame-ancestors 'none'    : anti-clickjacking (équivalent moderne
    #    de X-Frame-Options DENY, les deux sont émis)
    # §193 — PAS de upgrade-insecure-requests ici : ce fichier est partagé
    # par le HTTP 8080 (LAN / Playwright via host.docker.internal) ET le
    # HTTPS 8443. La directive forcerait Chrome à charger les scripts en
    # HTTPS quand l'origine n'est pas « localhost » → page blanche E2E.
    add_header Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://assets.narchi.de; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' blob: https://assets.narchi.de wss://$host ws://$host https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io; worker-src 'self' blob: https://assets.narchi.de; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;

    # Anti-clickjacking (legacy, doublé par frame-ancestors)
    add_header X-Frame-Options "DENY" always;
    # Anti MIME-sniffing (critique : on sert du WASM et des uploads)
    add_header X-Content-Type-Options "nosniff" always;
    # HSTS : HTTPS forcé 2 ans, sous-domaines inclus, éligible preload
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    # Referrer minimal vers les tiers
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    # Coupe les APIs capteurs inutilisées (réduction de surface)
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
    # Isolation cross-origin : active SharedArrayBuffer pour le runtime
    # multithread web-ifc-mt.wasm (toutes les ressources sont same-origin)
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;

    # ------------------------------------------------------------------
    # BLOCAGE DES FICHIERS SENSIBLES
    # ------------------------------------------------------------------
    location ~ /\.(?!well-known) {
        deny all;
        return 404;
    }
    location ~* \.(env|bak|old|sql|py|sh|yml|yaml|conf)$ {
        deny all;
        return 404;
    }

    # ------------------------------------------------------------------
    # RUNTIME WASM WEB-IFC (chargement local exclusif — zéro CDN)
    # ------------------------------------------------------------------
    location /ifc/ {
        root /usr/share/nginx/html; # Correction d'alias : root est infiniment plus robuste contre les 404 muets
        types {
            # Les Workers ES modules doivent être servis comme JavaScript.
            # Sans l'extension mjs, nginx retombe sur application/octet-stream
            # et le navigateur peut refuser le Worker module.
            application/javascript js mjs;
            application/wasm wasm;
            application/json json;
        }
        try_files $uri =404;

        add_header Cache-Control "public, max-age=31536000, immutable" always;
        # Ré-émission du bloc sécurité (héritage annulé par add_header local)
        add_header Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://assets.narchi.de; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' blob: https://assets.narchi.de wss://$host ws://$host https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io; worker-src 'self' blob: https://assets.narchi.de; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "cross-origin" always;
        add_header Access-Control-Allow-Origin "*" always;
    }

    # Modules ESM pré-bundlés That Open / Three, publics et versionnés.
    location /vendor/ {
        root /usr/share/nginx/html;
        types {
            application/javascript js;
            application/json json;
        }
        try_files $uri =404;
        # Les alias stables doivent être revalidés après chaque déploiement.
        # Les URLs utilisées par le bundle portent en plus un nom versionné.
        add_header Cache-Control "no-cache, must-revalidate, max-age=0" always;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cross-Origin-Resource-Policy "cross-origin" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    # ------------------------------------------------------------------
    # DIAGNOSTIC : une URL Worker undefined ne doit jamais devenir index.html.
    # ------------------------------------------------------------------
    location = /undefined {
        return 404;
    }

    # §205 — CA mkcert TELECHARGEABLE depuis le LAN (fichier PUBLIC, pas un secret).
    # Absent tant que 8_ACTIVER_HTTPS_LOCAL n'a pas copie le PEM -> 404 honnete.
    location = /narchi-ca.pem {
        alias /etc/nginx/tls/narchi-CA-POUR-TELEPHONE.pem;
        default_type application/x-pem-file;
        add_header Content-Disposition "attachment; filename=\"narchi-CA-POUR-TELEPHONE.pem\"" always;
        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    # SCRIPTS : ne jamais retourner index.html à la place d'un JS absent.
    # Cela transforme un faux succès HTTP 200 + MIME text/html en 404
    # explicite et permet d'identifier précisément le Worker manquant.
    # ------------------------------------------------------------------
    location ~* \.(?:js|mjs)$ {
        try_files $uri =404;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Cache-Control "no-cache, must-revalidate, max-age=0" always;
    }

    # ------------------------------------------------------------------
    # ASSETS FINGERPRINTÉS VITE (cache long, immutable)
    # ------------------------------------------------------------------
    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://assets.narchi.de; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' blob: https://assets.narchi.de wss://$host ws://$host https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io; worker-src 'self' blob: https://assets.narchi.de; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "same-origin" always;
    }

    # ------------------------------------------------------------------
    # DIAGNOSTICS NAVIGATEUR — petit payload, sans cookie ni Authorization
    # ------------------------------------------------------------------
    location = /api/v5/diagnostics/client-events {
        limit_req zone=narchi_api burst=10 nodelay;
        limit_req_status 429;
        client_max_body_size 32k;

        proxy_pass http://backend:8000/api/v5/diagnostics/client-events;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Cookie "";
        proxy_set_header Authorization "";
        proxy_read_timeout 10s;
        add_header Cache-Control "no-store" always;
        add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    # ------------------------------------------------------------------
    # AUTHENTIFICATION — anti brute-force uniquement sur les créations de
    # session. /auth/me est un probe normal au démarrage et ne doit jamais
    # épuiser le quota login (sinon une erreur frontend devient un faux 429).
    # ------------------------------------------------------------------
    location ~ ^/api/v5/auth/(token|guest-login)$ {
        limit_req zone=narchi_auth burst=5 nodelay;
        limit_req_status 429;

        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
        add_header Cache-Control "no-store" always;
        add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    }

    location /api/v5/auth/ {
        proxy_pass http://backend:8000/api/v5/auth/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
        add_header Cache-Control "no-store" always;
        add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    }

    # ------------------------------------------------------------------
    # WEBSOCKET CHAT TEMPS RÉEL (same-origin uniquement, cookie HttpOnly)
    # ------------------------------------------------------------------
    location /api/v5/chat/ws {
        proxy_pass http://backend:8000/api/v5/chat/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;      # connexions chat longue durée
        proxy_send_timeout 3600s;
    }

    # ------------------------------------------------------------------
    # WEBSOCKET CRDT §81 (co-édition Yjs /api/v5/collab/ws — connexions
    # longue durée, même durcissement same-origin/cookie que le chat)
    # ------------------------------------------------------------------
    location /api/v5/collab/ws {
        proxy_pass http://backend:8000/api/v5/collab/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # ------------------------------------------------------------------
    # PROXY API FASTAPI (uploads IFC, calculs DIN 276/HOAI, rapports)
    # ------------------------------------------------------------------
    location /api/ {
        limit_req zone=narchi_api burst=60 nodelay;
        limit_req_status 429;

        proxy_pass http://backend:8000/api/;
        proxy_http_version 1.1;
        proxy_request_buffering off;   # streaming des IFC volumineux
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ------------------------------------------------------------------
    # SPA — fallback index.html (déploiements sûrs)
    # ------------------------------------------------------------------
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
        add_header Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://assets.narchi.de; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' blob: https://assets.narchi.de wss://$host ws://$host https://*.supabase.co wss://*.supabase.co https://*.ingest.sentry.io; worker-src 'self' blob: https://assets.narchi.de; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "same-origin" always;
    }
