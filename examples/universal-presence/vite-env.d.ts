/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRESENCE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
