/**
 * 로그인 없이 접근 가능한 경로(검색 홈 등)와 로그인 필수 경로 구분
 */

export function isAuthRequiredPath(pathname: string): boolean {
  return (
    pathname.startsWith('/logs') ||
    pathname.startsWith('/cabinet') ||
    pathname.startsWith('/inventory') ||
    pathname.startsWith('/admin')
  );
}

/** Open redirect 방지: 앱 내부 상대 경로만 허용 */
export function sanitizeReturnTo(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('://')) return null;
  return raw;
}
