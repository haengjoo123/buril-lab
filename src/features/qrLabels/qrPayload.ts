/**
 * What a Buril Lab QR label encodes.
 *
 * Labels carry an app link so a phone's own camera opens the right screen,
 * and the in-app scanner reads the same link. The link holds only record ids
 * and the space they belong to: opening it still needs a signed-in member of
 * that space, so a label reveals nothing on its own.
 */
export const QR_LINK_ORIGIN = 'https://burillab.com';

/** `personal` is the signed-in user's own space; anything else is a lab id. */
export type QrSpace = 'personal' | string;

export type QrTarget =
    | { kind: 'inventory'; id: string; space: QrSpace }
    | { kind: 'container'; id: string; space: QrSpace };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ITEM_PARAM = 'item';
export const CONTAINER_PARAM = 'container';
export const SPACE_PARAM = 'space';

const PATHS: Record<QrTarget['kind'], { path: string; param: string }> = {
    inventory: { path: '/app/inventory', param: ITEM_PARAM },
    container: { path: '/app/logs', param: CONTAINER_PARAM },
};

export function spaceFor(labId: string | null | undefined): QrSpace {
    return labId ? labId : 'personal';
}

export function labIdFromSpace(space: QrSpace): string | null {
    return space === 'personal' ? null : space;
}

function isValidSpace(space: string): boolean {
    return space === 'personal' || UUID_PATTERN.test(space);
}

export function buildQrLink(target: QrTarget, origin: string = QR_LINK_ORIGIN): string {
    if (!UUID_PATTERN.test(target.id)) throw new Error('QR target id must be a UUID.');
    if (!isValidSpace(target.space)) throw new Error('QR space must be personal or a lab UUID.');
    const { path, param } = PATHS[target.kind];
    const url = new URL(path, origin);
    url.searchParams.set(param, target.id.toLowerCase());
    url.searchParams.set(SPACE_PARAM, target.space.toLowerCase());
    return url.toString();
}

/**
 * Reads a scanned code. Only links to this app (production, staging or the
 * current origin) with a valid id are accepted; anything else returns null so
 * an unrelated QR code is never followed.
 */
export function parseQrLink(raw: string, allowedOrigins: readonly string[] = []): QrTarget | null {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return null;
    }
    const origins = new Set([QR_LINK_ORIGIN, 'https://staging.burillab.com', ...allowedOrigins]);
    if (!origins.has(url.origin)) return null;
    const space = url.searchParams.get(SPACE_PARAM) ?? 'personal';
    if (!isValidSpace(space)) return null;
    for (const kind of ['inventory', 'container'] as const) {
        const { path, param } = PATHS[kind];
        if (url.pathname.replace(/\/+$/, '') !== path) continue;
        const id = url.searchParams.get(param);
        if (!id || !UUID_PATTERN.test(id)) return null;
        return { kind, id: id.toLowerCase(), space: space.toLowerCase() };
    }
    return null;
}

/** The in-app route for a target, keeping the space so the app can switch to it. */
export function qrTargetRoute(target: QrTarget): string {
    const { path, param } = PATHS[target.kind];
    const params = new URLSearchParams({ [param]: target.id, [SPACE_PARAM]: target.space });
    return `${path}?${params.toString()}`;
}
