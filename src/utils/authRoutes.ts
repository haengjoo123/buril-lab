import { getLabAppScopedPath, isLabAppPath, isOpsPath, isSafetyCenterPath } from './appRoutes';

const protectedLabAppPathPrefixes = ['/logs', '/cabinet', '/inventory', '/admin'];

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isAuthRequiredPath(pathname: string): boolean {
  const appScopedPathname = isLabAppPath(pathname)
    ? getLabAppScopedPath(pathname)
    : pathname;

  return (
    isSafetyCenterPath(pathname) ||
    isOpsPath(pathname) ||
    protectedLabAppPathPrefixes.some((prefix) => matchesPathPrefix(appScopedPathname, prefix)) ||
    pathname.startsWith('/feedback-admin')
  );
}

/** Open redirect 방지: 앱 내부 상대 경로만 허용 */
export function sanitizeReturnTo(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('://')) return null;
  return raw;
}
