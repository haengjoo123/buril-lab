/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_REDIRECT_URL?: string
  readonly VITE_INTERNAL_API_BASE_URL?: string
  readonly VITE_PUBLIC_APP_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_ENABLE_WASTE_V2?: string
  readonly VITE_ENABLE_PH_PREDICTION?: string
  readonly VITE_ENABLE_CHEMICAL_ENRICHMENT?: string
  readonly VITE_ENABLE_WASTE_CONTAINERS?: string
  readonly VITE_ENABLE_LAB_TOOLS?: string
  readonly VITE_ENABLE_CONTAINER_CONTENT_CHECK?: string
  readonly VITE_ENABLE_CONTAINER_PICKUP_REQUESTS?: string
  readonly VITE_ENABLE_DAILY_INSPECTION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
