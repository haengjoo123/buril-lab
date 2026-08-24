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

const RETURN_TO_BASE_URL = 'https://buril.invalid';

function containsUnsafeReturnToCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === '\\' || codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function hasUnsafeReturnToValue(value: string): boolean {
  return (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('://') ||
    containsUnsafeReturnToCharacter(value)
  );
}

/** Open redirect 방지: 정규화 뒤에도 앱 내부 상대 경로만 허용 */
export function sanitizeReturnTo(raw: string | null): string | null {
  if (!raw || hasUnsafeReturnToValue(raw)) return null;

  let decoded = raw;
  for (let depth = 0; depth < 2; depth += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (hasUnsafeReturnToValue(next)) return null;
      if (next === decoded) break;
      decoded = next;
    } catch {
      return null;
    }
  }

  try {
    if (new URL(raw, RETURN_TO_BASE_URL).origin !== RETURN_TO_BASE_URL) return null;
  } catch {
    return null;
  }

  return raw;
}
