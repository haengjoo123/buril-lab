import type { LabSafetyCenterLinkRequest, SafetyCenterRequestStatus } from '../safety-center/types';

/**
 * The next step a lab can take on a center request. A lab moves a request up to `submitted`
 * (its reply); the center reviews the reply and closes it, so there is no next step after that.
 */
export function nextLabRequestStatus(status: SafetyCenterRequestStatus): SafetyCenterRequestStatus | null {
  if (status === 'open') return 'in_progress';
  if (status === 'in_progress') return 'submitted';
  return null;
}

export type LabRequestLinkState = Pick<LabSafetyCenterLinkRequest, 'center_id' | 'link_status' | 'center_status'>;

/**
 * Whether the lab may close an unresolved request itself. Mirrors the database guard
 * (add_safety_center_request_event): only while the center can no longer see the request,
 * i.e. there is no approved link to an approved center. Otherwise the center closes it.
 *
 * `links` is null when they are not loaded (not an admin): the close action is then not offered.
 */
export function canLabCloseRequest(
  request: { status: SafetyCenterRequestStatus; center_id: string },
  links: ReadonlyArray<LabRequestLinkState> | null,
): boolean {
  if (links === null || request.status === 'resolved') return false;
  return !links.some((link) => (
    link.center_id === request.center_id
    && link.link_status === 'approved'
    && link.center_status === 'approved'
  ));
}
