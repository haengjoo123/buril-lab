import { Capacitor } from '@capacitor/core';
import { labAppRoute } from '../utils/appRoutes';
import { SITE_ORIGIN } from '../utils/seo';

/** Query params of a lab invite link: the lab to preselect and the name to search for. */
export const LAB_JOIN_ID_PARAM = 'joinLab';
export const LAB_JOIN_NAME_PARAM = 'lab';

const LAB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LAB_NAME_LENGTH = 120;

export interface LabJoinTarget {
    labId: string;
    labName: string;
}

export type LabInviteShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

/** Public origin a teammate can open; native builds have no shareable window origin. */
export function getLabInviteOrigin(): string {
    const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
    if (!Capacitor.isNativePlatform() && typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
        return window.location.origin;
    }
    return trimTrailingSlash(configured || SITE_ORIGIN);
}

/**
 * The invite opens the lab inventory (login first when needed, via the usual returnTo flow)
 * with the join view already searching for this lab. It never carries the join password.
 */
export function buildLabInviteUrl(target: LabJoinTarget, origin: string = getLabInviteOrigin()): string {
    const params = new URLSearchParams({
        [LAB_JOIN_ID_PARAM]: target.labId.toLowerCase(),
        [LAB_JOIN_NAME_PARAM]: target.labName.trim(),
    });
    return `${trimTrailingSlash(origin)}${labAppRoute('/inventory')}?${params.toString()}`;
}

export function readLabJoinTarget(search: string): LabJoinTarget | null {
    const params = new URLSearchParams(search);
    const labId = params.get(LAB_JOIN_ID_PARAM)?.trim() ?? '';
    const labName = (params.get(LAB_JOIN_NAME_PARAM) ?? '').trim().slice(0, MAX_LAB_NAME_LENGTH);
    if (!LAB_ID_PATTERN.test(labId) || !labName) return null;
    return { labId: labId.toLowerCase(), labName };
}

/** Returns the URL with the invite params removed (other params and the hash are kept). */
export function withoutLabJoinParams(href: string): string {
    const url = new URL(href);
    url.searchParams.delete(LAB_JOIN_ID_PARAM);
    url.searchParams.delete(LAB_JOIN_NAME_PARAM);
    return `${url.pathname}${url.search}${url.hash}`;
}

type ShareNavigator = Pick<Navigator, 'share' | 'clipboard'>;

/** Web Share sheet when available, otherwise copies the text and link to the clipboard. */
export async function shareLabInvite(
    payload: { title: string; text: string; url: string },
    nav: ShareNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): Promise<LabInviteShareOutcome> {
    if (typeof nav?.share === 'function') {
        try {
            await nav.share(payload);
            return 'shared';
        } catch (error) {
            if ((error as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
            // Share sheet unavailable (e.g. not allowed in this frame): fall back to copying.
        }
    }
    try {
        if (!nav?.clipboard?.writeText) return 'failed';
        await nav.clipboard.writeText(`${payload.text}\n${payload.url}`);
        return 'copied';
    } catch {
        return 'failed';
    }
}
