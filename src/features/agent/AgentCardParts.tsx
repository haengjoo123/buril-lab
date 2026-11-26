import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  AGENT_CARD,
  AGENT_CARD_TITLE,
  AGENT_DIRECTIONAL_ICON,
  AGENT_LINK_BUTTON,
  AGENT_NOTE,
  AGENT_SECONDARY_BUTTON,
  AGENT_SKELETON_LINE,
} from './agentCardStyles';
import { focusOnMount } from './agentFocus';

/**
 * Live regions that are in the page from the start, so that what they say
 * later is announced. A region that first appears with its text already in it
 * is silent to a screen reader. What is shown on screen is repeated here in
 * words; the visible copies carry no live role of their own.
 */
export function AgentAnnouncer({ status, alert = '' }: { status: string; alert?: string }) {
  return (
    <>
      <p role="status" className="sr-only" data-agent-announcer="status">{status}</p>
      <p role="alert" className="sr-only" data-agent-announcer="alert">{alert}</p>
    </>
  );
}

/** A card that only states something, with optional next steps. */
export function AgentNotice({ title, children, actions, hasInitialFocus = false }: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** Set when this card replaces one whose focused control has just gone away. */
  hasInitialFocus?: boolean;
}) {
  return (
    <section
      className={AGENT_CARD}
      tabIndex={hasInitialFocus ? -1 : undefined}
      ref={hasInitialFocus ? focusOnMount : undefined}
    >
      <h3 className={AGENT_CARD_TITLE}>{title}</h3>
      {children && <div className={`mt-2 ${AGENT_NOTE}`}>{children}</div>}
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}

/** A card with a title, the caveats that qualify it, its rows and its next steps. */
export function AgentCard({ title, notes, children, actions }: {
  title: string;
  /** What the answer could not cover; empty entries are skipped. */
  notes?: Array<string | null | false>;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const shownNotes = (notes ?? []).filter((note): note is string => Boolean(note));
  return (
    <section className={AGENT_CARD}>
      <h3 className={AGENT_CARD_TITLE}>{title}</h3>
      {shownNotes.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {shownNotes.map((note) => <p key={note} className={AGENT_NOTE}>{note}</p>)}
        </div>
      )}
      {children && <div className="mt-4">{children}</div>}
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}

/** Goes somewhere else in the app. Second to whatever the card itself is about. */
export function AgentGoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={AGENT_SECONDARY_BUTTON} onClick={onClick}>
      {label}
      <ArrowRight className={AGENT_DIRECTIONAL_ICON} aria-hidden="true" />
    </button>
  );
}

/** The same destination from inside a row, where a full button on every row would shout. */
export function AgentRowLink({ label, accessibleLabel, onClick }: {
  label: string;
  /** Names the row as well, so a list of identical links can be told apart. */
  accessibleLabel?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={AGENT_LINK_BUTTON} onClick={onClick} aria-label={accessibleLabel}>
      {label}
      <ArrowRight className={AGENT_DIRECTIONAL_ICON} aria-hidden="true" />
    </button>
  );
}

/** Holds the place of an answer that is being prepared, so the page does not jump when it arrives. */
export function AgentSkeleton() {
  return (
    <div className={AGENT_CARD} aria-hidden="true" data-agent-skeleton>
      <div className={`${AGENT_SKELETON_LINE} w-2/5`} />
      <div className="mt-4 flex flex-col gap-3">
        <div className={`${AGENT_SKELETON_LINE} w-full`} />
        <div className={`${AGENT_SKELETON_LINE} w-11/12`} />
        <div className={`${AGENT_SKELETON_LINE} w-3/5`} />
      </div>
    </div>
  );
}
