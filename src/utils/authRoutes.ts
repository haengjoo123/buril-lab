import { isLabAppPath, isOpsPath, isSafetyCenterPath } from './appRoutes';

export function isAuthRequiredPath(pathname: string): boolean {
  return (
    isLabAppPath(pathname) ||
    isSafetyCenterPath(pathname) ||
    isOpsPath(pathname) ||
    pathname.startsWith('/logs') ||
    pathname.startsWith('/cabinet') ||
    pathname.startsWith('/inventory') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/feedback-admin')
  );
}

/** Open redirect 방지: 앱 내부 상대 경로만 허용 */
export function sanitizeReturnTo(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('://')) return null;
  return raw;
}
