import { Capacitor } from '@capacitor/core'

const configuredApiBaseUrl = import.meta.env.VITE_INTERNAL_API_BASE_URL?.trim()
const configuredAppUrl = import.meta.env.VITE_PUBLIC_APP_URL?.trim()

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Capacitor 앱 안에서는 상대경로 API가 localhost로 향하므로
 * 배포된 Cloudflare Pages 주소를 명시적으로 사용합니다.
 */
export function getInternalApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (Capacitor.isNativePlatform()) {
    const nativeBaseUrl = configuredApiBaseUrl || configuredAppUrl

    if (!nativeBaseUrl) {
      throw new Error('Native builds require VITE_INTERNAL_API_BASE_URL or VITE_PUBLIC_APP_URL.')
    }

    return `${trimTrailingSlash(nativeBaseUrl)}${normalizedPath}`
  }

  if (configuredApiBaseUrl) {
    return `${trimTrailingSlash(configuredApiBaseUrl)}${normalizedPath}`
  }

  return normalizedPath
}
