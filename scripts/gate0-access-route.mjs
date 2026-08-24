export async function fulfillStagingAccessRoute(route, { clientId, clientSecret }) {
  if (!clientId || !clientSecret) {
    throw new Error('Both Staging Access service-token values are required together.')
  }

  // Fetch exactly one protected-origin hop. If it is a redirect, fulfilling the
  // 3xx lets the browser issue the next request itself; the route matcher then
  // decides whether the Access headers are appropriate for that new origin.
  const response = await route.fetch({
    headers: {
      ...route.request().headers(),
      'CF-Access-Client-Id': clientId,
      'CF-Access-Client-Secret': clientSecret,
    },
    maxRedirects: 0,
  })
  await route.fulfill({ response })
}
