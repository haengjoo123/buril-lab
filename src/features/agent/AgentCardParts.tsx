import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { AGENT_CARD, AGENT_CARD_TITLE, AGENT_NOTE, AGENT_SECONDARY_BUTTON } from './agentCardStyles';

/** A card that only states something, with optional next steps. */
export function AgentNotice({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={AGENT_CARD}>
      <h3 className={AGENT_CARD_TITLE}>{title}</h3>
      {children && <div className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400">{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
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
      {shownNotes.map((note) => <p key={note} className={`mt-1.5 ${AGENT_NOTE}`}>{note}</p>)}
      {children && <div className="mt-3">{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}

export function AgentGoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={AGENT_SECONDARY_BUTTON} onClick={onClick}>
      {label}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
