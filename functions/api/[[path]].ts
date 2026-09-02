import { json } from './_shared/json'

// The API middleware normally returns the 404 before this handler runs. This
// catch-all also prevents Cloudflare Pages from falling back to the SPA HTML if
// an unknown /api/* path bypasses a more specific file route.
export const onRequest = () => json(
  { error: 'API route was not found.', code: 'API_NOT_FOUND' },
  { status: 404 },
)
