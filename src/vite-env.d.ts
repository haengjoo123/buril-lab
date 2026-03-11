/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INTERNAL_API_BASE_URL?: string
  readonly VITE_PUBLIC_APP_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
