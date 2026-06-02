export const LAB_APP_BASE_PATH = '/app';
export const SAFETY_CENTER_BASE_PATH = '/center';
export const OPS_BASE_PATH = '/ops';

export function isLabAppPath(pathname: string): boolean {
  return pathname === LAB_APP_BASE_PATH || pathname.startsWith(`${LAB_APP_BASE_PATH}/`);
}

export function isSafetyCenterPath(pathname: string): boolean {
  return pathname === SAFETY_CENTER_BASE_PATH || pathname.startsWith(`${SAFETY_CENTER_BASE_PATH}/`);
}

export function isOpsPath(pathname: string): boolean {
  return pathname === OPS_BASE_PATH || pathname.startsWith(`${OPS_BASE_PATH}/`);
}

export function getLabAppScopedPath(pathname: string): string {
  if (pathname === LAB_APP_BASE_PATH) return '/';
  if (pathname.startsWith(`${LAB_APP_BASE_PATH}/`)) {
    return pathname.slice(LAB_APP_BASE_PATH.length) || '/';
  }
  return pathname;
}

export function labAppRoute(path: string = '/'): string {
  if (!path || path === '/') return LAB_APP_BASE_PATH;
  return `${LAB_APP_BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getLegacyLabAppRedirect(pathname: string): string | null {
  if (pathname === '/search') return labAppRoute();
  if (pathname === '/logs') return labAppRoute('/logs');
  if (pathname === '/cabinet') return labAppRoute('/cabinet');
  if (pathname === '/inventory') return labAppRoute('/inventory');
  if (pathname === '/admin') return labAppRoute('/admin');
  return null;
}
