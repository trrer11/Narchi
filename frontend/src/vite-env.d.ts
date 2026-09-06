/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_IFC_WASM_BASE?: string;
  readonly VITE_FRAGMENTS_WORKER_URL?: string;
  readonly VITE_ASSET_BASE?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  readonly VITE_APP_RELEASE?: string;
  readonly VITE_ENABLE_OFFLINE_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
