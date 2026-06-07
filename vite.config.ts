import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

type AdminIdentity = {
  id: string
  email: string
}

type LocalAdminContext = {
  adminClient: SupabaseClient
  identity: AdminIdentity
}

const feedbackSelectFields = [
  'id',
  'type',
  'message',
  'contact',
  'user_email',
  'user_id',
  'user_agent',
  'created_at',
  'status',
  'resolved_at',
  'resolved_by',
].join(', ')

const safetyCenterSelectFields = [
  'id',
  'institution_name',
  'institution_domain',
  'center_name',
  'status',
  'created_by',
  'approved_by',
  'approved_at',
  'verification_document_path',
  'verification_document_name',
  'verification_document_mime_type',
  'verification_document_size',
  'verification_document_uploaded_at',
  'created_at',
  'updated_at',
].join(', ')

function sendJson(response: ServerResponse, status: number, data: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(data))
}

function parseAdminEmails(...rawValues: Array<string | undefined>): Set<string> {
  return new Set(
    rawValues
      .filter(Boolean)
      .join(',')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function getSupabaseConfig(env: Record<string, string>) {
  return {
    url: env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim(),
    anonKey: env.SUPABASE_ANON_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim(),
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  }
}

async function readJsonBody<TBody>(request: IncomingMessage): Promise<TBody> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf8')
  return (raw ? JSON.parse(raw) : {}) as TBody
}

async function requireLocalAdmin(
  request: IncomingMessage,
  env: Record<string, string>,
): Promise<{ ok: true; context: LocalAdminContext } | { ok: false; status: number; error: string }> {
  const authHeader = getHeaderValue(request.headers.authorization)
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Authentication is required.' }
  }

  const { url, anonKey, serviceRoleKey } = getSupabaseConfig(env)
  if (!url || !anonKey) {
    return { ok: false, status: 500, error: 'Supabase URL or anon key is not configured.' }
  }

  if (!serviceRoleKey) {
    return { ok: false, status: 500, error: 'Supabase service role key is not configured.' }
  }

  const userClient = createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) {
    return { ok: false, status: 401, error: 'Authentication is required.' }
  }

  const allowlist = parseAdminEmails(env.OPS_ADMIN_EMAILS, env.FEEDBACK_ADMIN_EMAILS)
  if (allowlist.size === 0) {
    return { ok: false, status: 500, error: 'Operator admin allowlist is not configured.' }
  }

  const email = data.user.email?.trim().toLowerCase()
  if (!email || !allowlist.has(email)) {
    return { ok: false, status: 403, error: 'This page is only available to allowlisted operators.' }
  }

  return {
    ok: true,
    context: {
      adminClient: createClient(url, serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }),
      identity: {
        id: data.user.id,
        email,
      },
    },
  }
}

function localAdminApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'buril-local-admin-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname

        if (!pathname.startsWith('/api/admin/feedback/') && !pathname.startsWith('/api/admin/safety-centers/')) {
          next()
          return
        }

        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Method not allowed.' })
          return
        }

        const auth = await requireLocalAdmin(request, env)
        if (!auth.ok) {
          sendJson(response, auth.status, { error: auth.error })
          return
        }

        try {
          if (pathname === '/api/admin/feedback/list') {
            const { data, error } = await auth.context.adminClient
              .from('feedback')
              .select(feedbackSelectFields)
              .order('created_at', { ascending: false })
              .limit(200)

            sendJson(response, error ? 500 : 200, error ? { error: error.message } : { items: data || [] })
            return
          }

          if (pathname === '/api/admin/feedback/status') {
            const body = await readJsonBody<{ feedbackId?: string; status?: string }>(request)
            const feedbackId = body.feedbackId?.trim()
            const status = body.status?.trim()

            if (!feedbackId || !status || !['new', 'in_progress', 'resolved'].includes(status)) {
              sendJson(response, 400, { error: 'feedbackId and a valid status are required.' })
              return
            }

            const nowIso = new Date().toISOString()
            const { data, error } = await auth.context.adminClient
              .from('feedback')
              .update({
                status,
                updated_at: nowIso,
                resolved_at: status === 'resolved' ? nowIso : null,
                resolved_by: status === 'resolved' ? auth.context.identity.id : null,
              })
              .eq('id', feedbackId)
              .select(feedbackSelectFields)
              .single()

            sendJson(response, error ? (error.code === 'PGRST116' ? 404 : 500) : 200, error ? { error: error.message } : { item: data })
            return
          }

          if (pathname === '/api/admin/safety-centers/list') {
            const { data, error } = await auth.context.adminClient
              .from('safety_centers')
              .select(safetyCenterSelectFields)
              .order('created_at', { ascending: false })
              .limit(200)

            sendJson(response, error ? 500 : 200, error ? { error: error.message } : { items: data || [] })
            return
          }

          if (pathname === '/api/admin/safety-centers/status') {
            const body = await readJsonBody<{ centerId?: string; status?: string }>(request)
            const centerId = body.centerId?.trim()
            const status = body.status?.trim()

            if (!centerId || !status || !['pending', 'approved', 'rejected'].includes(status)) {
              sendJson(response, 400, { error: 'centerId and a valid status are required.' })
              return
            }

            const nowIso = new Date().toISOString()

            if (status === 'approved') {
              const { data: existingCenter, error: fetchError } = await auth.context.adminClient
                .from('safety_centers')
                .select('id, verification_document_path')
                .eq('id', centerId)
                .single()

              if (fetchError) {
                sendJson(response, fetchError.code === 'PGRST116' ? 404 : 500, { error: fetchError.message })
                return
              }

              if (!existingCenter?.verification_document_path) {
                sendJson(response, 400, { error: 'Verification document is required before approving a safety center.' })
                return
              }
            }

            const { data, error } = await auth.context.adminClient
              .from('safety_centers')
              .update({
                status,
                approved_by: status === 'approved' ? auth.context.identity.id : null,
                approved_at: status === 'approved' ? nowIso : null,
                updated_at: nowIso,
              })
              .eq('id', centerId)
              .select(safetyCenterSelectFields)
              .single()

            sendJson(response, error ? (error.code === 'PGRST116' ? 404 : 500) : 200, error ? { error: error.message } : { item: data })
            return
          }

          if (pathname === '/api/admin/safety-centers/document-url') {
            const body = await readJsonBody<{ centerId?: string }>(request)
            const centerId = body.centerId?.trim()

            if (!centerId) {
              sendJson(response, 400, { error: 'centerId is required.' })
              return
            }

            const { data: center, error: fetchError } = await auth.context.adminClient
              .from('safety_centers')
              .select('verification_document_path, verification_document_name')
              .eq('id', centerId)
              .single()

            if (fetchError) {
              sendJson(response, fetchError.code === 'PGRST116' ? 404 : 500, { error: fetchError.message })
              return
            }

            if (!center?.verification_document_path) {
              sendJson(response, 404, { error: 'Verification document is not attached.' })
              return
            }

            const { data: signedUrl, error: signedUrlError } = await auth.context.adminClient.storage
              .from('safety-center-verifications')
              .createSignedUrl(center.verification_document_path, 60, {
                download: center.verification_document_name || undefined,
              })

            sendJson(
              response,
              signedUrlError ? 500 : 200,
              signedUrlError
                ? { error: signedUrlError.message }
                : { url: signedUrl.signedUrl, expiresIn: 60, fileName: center.verification_document_name },
            )
            return
          }

          sendJson(response, 404, { error: 'Admin API route was not found.' })
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : 'Admin API request failed.' })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) {
            return 'xlsx-vendor'
          }

          if (
            id.includes('node_modules/html2canvas') ||
            id.includes('node_modules/jspdf') ||
            id.includes('node_modules/html2pdf.js')
          ) {
            return 'pdf-vendor'
          }

          if (id.includes('node_modules/lucide-react')) {
            return 'icons-vendor'
          }

          if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run/router')) {
            return 'router-vendor'
          }

          if (id.includes('node_modules/@supabase/supabase-js')) {
            return 'supabase-vendor'
          }

          if (
            id.includes('node_modules/three') ||
            id.includes('node_modules/@react-three') ||
            id.includes('node_modules/@react-spring/three') ||
            id.includes('node_modules/three-stdlib') ||
            id.includes('node_modules/camera-controls') ||
            id.includes('node_modules/meshline') ||
            id.includes('node_modules/maath') ||
            id.includes('node_modules/troika') ||
            id.includes('node_modules/suspend-react') ||
            id.includes('node_modules/stats-gl')
          ) {
            return 'three-vendor'
          }

          if (
            id.includes('node_modules/@google/genai') ||
            id.includes('node_modules/openai') ||
            id.includes('node_modules/axios') ||
            id.includes('node_modules/cheerio') ||
            id.includes('node_modules/fast-xml-parser')
          ) {
            return 'ai-vendor'
          }
        },
      },
    },
  },
  plugins: [
    localAdminApiPlugin(env),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png'],
      manifest: {
        name: 'Buril-Lab — 랩실 폐시약 안전 관리',
        short_name: 'Buril-Lab',
        description: '실험실 폐시약을 안전하게 분류하고 처리하는 솔루션',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        categories: ['education', 'utilities'],
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // 현재 메인 번들이 기본 precache 한도(2 MiB)를 넘어서므로 배포 빌드를 위해 상향합니다.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          // PubChem API — NetworkFirst (offline fallback to cache)
          {
            urlPattern: /^https:\/\/pubchem\.ncbi\.nlm\.nih\.gov\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pubchem-api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // KOSHA API — NetworkFirst
          {
            urlPattern: /^https:\/\/msds\.kosha\.or\.kr\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'kosha-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Supabase API — NetworkFirst
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 // 1 hour
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Google Fonts stylesheets — StaleWhileRevalidate
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              }
            }
          },
          // Google Fonts webfonts — CacheFirst
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Pretendard Font CDN — CacheFirst
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pretendard-font-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    // 같은 Wi‑Fi의 모바일에서 접속 가능 (주소는 터미널에 표시됨)
    host: true,
    proxy: {
      '/api/kosha': {
        target: 'https://msds.kosha.or.kr/openapi/service/msdschem',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kosha/, ''),
      },
    },
  },
  }
})
