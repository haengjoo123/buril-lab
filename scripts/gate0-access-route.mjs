import { isStagingGate0AccessRequest } from './gate0-staging-target.mjs'

const ACCESS_HEADER_PATTERN = /^cf-access-client-(?:id|secret)$/i

export async function fulfillStagingAccessRoute(route, {
  clientId,
  clientSecret,
  targetOrigin,
  deploymentId,
}) {
  if (!clientId?.trim() || !clientSecret?.trim()) {
    throw new Error('Both Staging Access service-token values are required together.')
  }

  if (!isStagingGate0AccessRequest({
    targetOrigin,
    deploymentId,
    requestUrl: route.request().url(),
  })) {
    throw new Error('Staging Access credentials require an approved request origin and path.')
  }

  const requestHeaders = Object.fromEntries(
    Object.entries(route.request().headers())
      .filter(([name]) => !ACCESS_HEADER_PATTERN.test(name)),
  )

  // Fetch exactly one protected-origin hop. If it is a redirect, fulfilling the
  // 3xx lets the browser issue the next request itself; the route matcher then
  // decides whether the Access headers are appropriate for that new origin.
  const response = await route.fetch({
    headers: {
      ...requestHeaders,
      'CF-Access-Client-Id': clientId,
      'CF-Access-Client-Secret': clientSecret,
    },
    maxRedirects: 0,
  })
  await route.fulfill({ response })
}
