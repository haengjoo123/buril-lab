import type { FeedbackType } from '../types/feedback';
import type { AppTab } from '../hooks/useAppUiState';

export interface FeedbackInsertInput {
  type: FeedbackType;
  message: string;
  contact: string;
  user: { id: string; email?: string | null } | null;
  /** The lab space the app is in (null in personal space). */
  currentLabId: string | null;
  /** The tab the settings were opened from. */
  sourceScreen?: AppTab;
}

export interface FeedbackInsert {
  type: FeedbackType;
  message: string;
  contact: string | null;
  user_email: string | null;
  user_id: string | null;
  user_agent: string;
  lab_id: string | null;
  source_screen: AppTab | null;
}

/**
 * Row for `public.feedback`. The lab is attached only for a signed-in user in a lab space
 * (the insert policy accepts only the sender's own memberships); guests never send one.
 */
export function buildFeedbackInsert(input: FeedbackInsertInput, userAgent: string): FeedbackInsert {
  return {
    type: input.type,
    message: input.message.trim(),
    contact: input.contact.trim() || null,
    user_email: input.user?.email ?? null,
    user_id: input.user?.id ?? null,
    user_agent: userAgent,
    lab_id: input.user ? input.currentLabId : null,
    source_screen: input.sourceScreen ?? null,
  };
}
