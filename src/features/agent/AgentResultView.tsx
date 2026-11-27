import { useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, ArrowRight, Loader2, MapPin, RotateCcw, Search, Sparkles } from 'lucide-react';
import type { InventoryItem } from '../../services/inventoryService';
import type { AgentStatus, AgentTurn } from '../../store/useAgentStore';
import { getExpiryStatus, type ExpiryStatus } from '../../utils/expiryStatus';
import { agentActions } from './agentActions';
import { AgentAnnouncer, AgentNotice, AgentRowLink, AgentSkeleton } from './AgentCardParts';
import { AgentProposalCard } from './AgentProposalCards';
import { AgentStatusCard } from './AgentStatusCards';
import {
  AGENT_BADGE,
  AGENT_CARD,
  AGENT_CARD_TITLE,
  AGENT_DIRECTIONAL_ICON,
  AGENT_FACT_LABEL,
  AGENT_FOOTNOTE,
  AGENT_LINK_BUTTON,
  AGENT_NOTE,
  AGENT_PRIMARY_BUTTON,
  AGENT_ROW,
  AGENT_ROW_META,
  AGENT_ROW_TITLE,
  AGENT_SECONDARY_BUTTON,
  AGENT_SPINNER,
  AGENT_STACK,
  AGENT_SUGGESTION,
} from './agentCardStyles';
import { isAgentStatusCapabilityId, type AgentFacet } from './agentContract';
import {
  isAgentProposalResult,
  isAgentStatusResult,
  type AgentErrorKind,
  type AgentResult,
  type AgentRunnablePlan,
  type AgentUiAction,
} from './agentResults';
import { inventoryFilterForWindow } from './executors/expiryList';

interface AgentResultViewProps {
  status: AgentStatus;
  turn: AgentTurn | null;
  onUiAction: (action: AgentUiAction) => void;
  onExample: (text: string) => void;
  onRetry: () => void;
  /** Leaves a proposal without saving anything. */
  onDismissProposal: () => void;
  /** A proposal was confirmed and saved. */
  onProposalConfirmed: () => void;
}

const EXAMPLE_KEYS = ['agent_example_expired', 'agent_example_location', 'agent_example_screen'] as const;

/** What the request was taken to mean, built from the typed plan and never from model text. */
function interpretedLabel(plan: AgentRunnablePlan | null, t: TFunction): string | null {
  if (!plan) return null;
  if (plan.kind === 'item_lookup') return t(`agent_interpreted_item_${plan.facet}`, { item: plan.item.text });
  if (plan.kind === 'expiry_list') return t(`agent_interpreted_expiry_${plan.window}`);
  if (plan.kind === 'waste_summary') {
    return t('agent_interpreted_waste_summary', { period: t(`agent_waste_period_${plan.period}`) });
  }
  if (plan.kind === 'log_usage') return t(`agent_interpreted_log_usage_${plan.change.kind}`, { item: plan.item.text });
  if (plan.kind === 'register_item') return t('agent_interpreted_register_item', { item: plan.name });
  if (plan.kind === 'request_purchase') return t('agent_interpreted_request_purchase', { item: plan.item.text });
  if (plan.kind === 'waste_batch') return t('agent_interpreted_waste_batch', { count: plan.components.length });
  if (isAgentStatusCapabilityId(plan.kind) || plan.kind === 'container_status' || plan.kind === 'pickup_request') {
    return t(`agent_interpreted_${plan.kind}`);
  }
  return null;
}

function locationLabel(item: InventoryItem, t: TFunction): string {
  if (item.storage_type === 'cabinet' && item.cabinet_name) {
    return typeof item.shelf_level === 'number'
      ? `${item.cabinet_name} · ${t('cabinet_shelf_level', { level: item.shelf_level + 1 })}`
      : item.cabinet_name;
  }
  return item.storage_location_name || t('agent_location_missing');
}

function cabinetAction(item: InventoryItem): AgentUiAction | null {
  if (item.storage_type !== 'cabinet' || !item.cabinet_id) return null;
  return {
    type: 'open_cabinet',
    cabinetId: item.cabinet_id,
    // Only a cabinet record's own id can be highlighted in the cabinet view.
    itemId: item._source === 'cabinet_item' ? item.id : null,
    shelfId: item.shelf_id ?? null,
  };
}

/**
 * One fact about a record: a label beside its value in a narrow card, above it
 * where the card has room for three across. The label column takes the width of
 * its longest label, whatever the language. The fact that was asked about is the heavier one.
 */
function Fact({ label, isEmphasized, children }: { label: string; isEmphasized: boolean; children: ReactNode }) {
  return (
    <div className="contents @md:block">
      <dt className={AGENT_FACT_LABEL}>{label}</dt>
      <dd className={`min-w-0 break-words text-sm leading-6 ${isEmphasized
        ? 'font-semibold text-slate-900 dark:text-slate-100'
        : 'text-slate-700 dark:text-slate-300'}`}>{children}</dd>
    </div>
  );
}

const EXPIRY_BADGE: Record<NonNullable<ExpiryStatus['level']>, string> = {
  expired: AGENT_BADGE.danger,
  critical: AGENT_BADGE.danger,
  warning: AGENT_BADGE.warning,
  ok: AGENT_BADGE.ok,
};

/** The label says how long is left; the colour only repeats it. */
function ExpiryBadge({ status, t }: { status: ExpiryStatus; t: TFunction }) {
  if (!status.level) return null;
  return <span className={EXPIRY_BADGE[status.level]}>{t(status.labelKey, status.labelParams)}</span>;
}

function ItemRow({ item, facet, onUiAction }: {
  item: InventoryItem;
  facet: AgentFacet | null;
  onUiAction: (action: AgentUiAction) => void;
}) {
  const { t } = useTranslation();
  const action = cabinetAction(item);
  const expiry = getExpiryStatus(item.expiry_date);
  const detail = [item.brand, item.capacity].filter(Boolean).join(' · ');

  return (
    <li className={AGENT_ROW}>
      <p className={AGENT_ROW_TITLE}>{item.name}</p>
      {detail && <p className={AGENT_ROW_META}>{detail}</p>}
      <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 @md:grid-cols-3 @md:gap-x-4">
        <Fact label={t('agent_fact_location')} isEmphasized={facet === 'location'}>
          <span className="flex min-w-0 items-baseline gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <span className="min-w-0">{locationLabel(item, t)}</span>
          </span>
        </Fact>
        <Fact label={t('agent_fact_remaining')} isEmphasized={facet === 'remaining'}>
          {typeof item.remaining_percent === 'number'
            ? t('agent_remaining_percent', { percent: item.remaining_percent })
            : t('agent_value_missing')}
        </Fact>
        <Fact label={t('agent_fact_expiry')} isEmphasized={facet === 'expiry'}>
          {expiry && item.expiry_date
            ? <span className="flex flex-wrap items-center gap-1.5">{item.expiry_date}<ExpiryBadge status={expiry} t={t} /></span>
            : t('agent_value_missing')}
        </Fact>
      </dl>
      {action && (
        <AgentRowLink
          label={t('agent_open_cabinet')}
          accessibleLabel={`${item.name} · ${t('agent_open_cabinet')}`}
          onClick={() => onUiAction(action)}
        />
      )}
    </li>
  );
}

function ResultBlock({ result, onUiAction, onExample, onDismissProposal, onProposalConfirmed }: {
  result: AgentResult;
  onUiAction: (action: AgentUiAction) => void;
  onExample: (text: string) => void;
  onDismissProposal: () => void;
  onProposalConfirmed: () => void;
}) {
  const { t } = useTranslation();
  const openInventory = (
    <button type="button" className={AGENT_SECONDARY_BUTTON} onClick={() => onUiAction({ type: 'open_screen', screen: 'inventory' })}>
      {t('agent_open_inventory')}
      <ArrowRight className={AGENT_DIRECTIONAL_ICON} aria-hidden="true" />
    </button>
  );

  if (isAgentStatusResult(result)) return <AgentStatusCard result={result} onUiAction={onUiAction} />;

  if (isAgentProposalResult(result)) {
    return (
      <AgentProposalCard
        result={result}
        actions={agentActions}
        onUiAction={onUiAction}
        onDismiss={onDismissProposal}
        onConfirmed={onProposalConfirmed}
      />
    );
  }

  if (result.type === 'item_matches') {
    return (
      <section className={AGENT_CARD}>
        <h3 className={AGENT_CARD_TITLE}>
          {t('agent_item_matches_title', { query: result.query, count: result.items.length + result.hiddenCount })}
        </h3>
        {result.aliasOnly && (
          <p className={`mt-2 flex items-start gap-2 ${AGENT_NOTE}`}>
            <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
            <span>{t('agent_item_alias_notice')}</span>
          </p>
        )}
        <ul className="mt-4">
          {result.items.map((item) => (
            <ItemRow key={`${item._source ?? 'inventory'}:${item.id}`} item={item} facet={result.facet} onUiAction={onUiAction} />
          ))}
        </ul>
        {result.hiddenCount > 0 && (
          <p className={`mt-3 ${AGENT_NOTE}`}>{t('agent_more_items', { count: result.hiddenCount })}</p>
        )}
      </section>
    );
  }

  if (result.type === 'item_no_match') {
    return result.inventoryIsEmpty ? (
      <AgentNotice title={t('agent_inventory_empty_title')} actions={openInventory}>
        {t('agent_inventory_empty_desc')}
      </AgentNotice>
    ) : (
      <AgentNotice
        title={t('agent_item_no_match_title', { query: result.query })}
        actions={<>
          <button type="button" className={AGENT_PRIMARY_BUTTON} onClick={() => onUiAction({ type: 'search_chemical', query: result.query })}>
            <Search className="h-4 w-4" aria-hidden="true" />
            {t('agent_view_in_search')}
          </button>
          {openInventory}
        </>}
      >
        {t('agent_item_no_match_desc')}
      </AgentNotice>
    );
  }

  if (result.type === 'expiry_list') {
    const filter = inventoryFilterForWindow(result.window);
    const hiddenCount = result.total - result.rows.length;
    if (result.inventoryCount === 0) {
      return (
        <AgentNotice title={t('agent_inventory_empty_title')} actions={openInventory}>
          {t('agent_inventory_empty_desc')}
        </AgentNotice>
      );
    }
    return (
      <section className={AGENT_CARD}>
        <h3 className={AGENT_CARD_TITLE}>
          {t(result.total > 0 ? `agent_expiry_title_${result.window}` : `agent_expiry_none_${result.window}`, { count: result.total })}
        </h3>
        {result.undatedCount > 0 && (
          <p className={`mt-2 ${AGENT_NOTE}`}>
            {t('agent_expiry_undated', { count: result.undatedCount })}
          </p>
        )}
        {result.rows.length > 0 && (
          <ul className="mt-4">
            {result.rows.map(({ item }) => (
              <ItemRow key={`${item._source ?? 'inventory'}:${item.id}`} item={item} facet="expiry" onUiAction={onUiAction} />
            ))}
          </ul>
        )}
        {hiddenCount > 0 && (
          <p className={`mt-3 ${AGENT_NOTE}`}>{t('agent_more_items', { count: hiddenCount })}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={AGENT_SECONDARY_BUTTON}
            onClick={() => onUiAction({ type: 'open_inventory', filter: result.total > 0 ? filter : null })}
          >
            {t(result.total > 0 ? 'agent_open_inventory_filtered' : 'agent_open_inventory')}
            <ArrowRight className={AGENT_DIRECTIONAL_ICON} aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  }

  if (result.type === 'disposal_redirect') {
    return (
      <AgentNotice
        title={t('agent_disposal_title')}
        actions={<>
          <button type="button" className={AGENT_PRIMARY_BUTTON} onClick={() => onUiAction({ type: 'open_screen', screen: 'cart' })}>
            {t('agent_disposal_open_review')}
          </button>
          <button type="button" className={AGENT_SECONDARY_BUTTON} onClick={() => onUiAction({ type: 'open_screen', screen: 'logs' })}>
            {t('agent_disposal_open_logs')}
          </button>
        </>}
      >
        {t('agent_disposal_desc')}
      </AgentNotice>
    );
  }

  if (result.type === 'screen_unavailable') {
    return <AgentNotice title={t(`agent_screen_unavailable_${result.reason}`)} />;
  }

  return (
    <AgentNotice
      title={t(`agent_unsupported_${result.reason}`)}
      actions={EXAMPLE_KEYS.map((key) => (
        <button key={key} type="button" className={AGENT_SECONDARY_BUTTON} onClick={() => onExample(t(key))}>
          {t(key)}
        </button>
      ))}
    >
      {t('agent_unsupported_hint')}
    </AgentNotice>
  );
}

const RETRYABLE_ERRORS = new Set<AgentErrorKind>(['failed', 'rate_limited']);

/**
 * The agent mode result area. It renders typed results from the lab's own
 * records; nothing a model wrote is displayed.
 */
export function AgentResultView({
  status, turn, onUiAction, onExample, onRetry, onDismissProposal, onProposalConfirmed,
}: AgentResultViewProps) {
  const { t } = useTranslation();
  const idleRef = useRef<HTMLElement>(null);

  // Cancelling a proposal removes the button that had the focus. The examples take it,
  // rather than the request field, so that a phone does not raise its keyboard.
  const dismissProposal = () => {
    flushSync(onDismissProposal);
    idleRef.current?.focus();
  };

  if (!turn) {
    return (
      <div className="contents">
        <AgentAnnouncer status="" />
        <section ref={idleRef} tabIndex={-1} className={`${AGENT_STACK} outline-none`} data-agent-result="idle">
          {/* Wide and desktop layouts already show this copy as the page heading. */}
          <div className="agent-intro-copy flex items-start gap-3 wide:hidden">
            <Sparkles className="mt-1 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <div className="min-w-0">
              <h3 className={AGENT_CARD_TITLE}>{t('agent_heading_title')}</h3>
              <p className={`mt-1 ${AGENT_NOTE}`}>{t('agent_heading_desc')}</p>
            </div>
          </div>
          <p className={AGENT_NOTE}>{t('agent_intro_note')}</p>
          <div>
            <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">{t('agent_examples_label')}</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {EXAMPLE_KEYS.map((key) => (
                <li key={key} className="min-w-0 max-w-full">
                  <button type="button" onClick={() => onExample(t(key))} className={AGENT_SUGGESTION}>
                    <span className="truncate">{t(key)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    );
  }

  const interpreted = interpretedLabel(turn.plan, t);
  const working = status !== 'idle';
  const statusText = working ? t(status === 'planning' ? 'agent_status_planning' : 'agent_status_running') : '';
  const errorText = turn.error ? t(`agent_error_${turn.error}`) : '';
  // What is on screen, said once in words. The regions stay mounted across requests.
  const announcement = working
    ? statusText
    : turn.result
      ? interpreted ? t('agent_announce_result_for', { subject: interpreted }) : t('agent_announce_result')
      : '';

  return (
    <div className="contents">
      <AgentAnnouncer status={announcement} alert={errorText} />
      <section
        className={AGENT_STACK}
        data-agent-result={working ? status : 'done'}
        aria-busy={working}
      >
        {interpreted && (
          <p className={AGENT_FOOTNOTE}>
            {t('agent_interpreted_as')} <span className="font-semibold text-slate-700 dark:text-slate-200">{interpreted}</span>
          </p>
        )}

        {working && (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
              <Loader2 className={AGENT_SPINNER} aria-hidden="true" />
              <span>{statusText}</span>
            </div>
            <AgentSkeleton />
          </>
        )}

        {turn.error && (
          <div className="flex items-start gap-2 text-sm">
            <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className={AGENT_NOTE}>{errorText}</p>
              {RETRYABLE_ERRORS.has(turn.error) && (
                <button type="button" onClick={onRetry} className={AGENT_LINK_BUTTON}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {t('search_retry')}
                </button>
              )}
            </div>
          </div>
        )}

        {turn.result && (
          <ResultBlock
            // A new request starts a new card, so a proposal never keeps choices made for another one.
            key={turn.id}
            result={turn.result}
            onUiAction={onUiAction}
            onExample={onExample}
            onDismissProposal={dismissProposal}
            onProposalConfirmed={onProposalConfirmed}
          />
        )}

        {turn.result && (turn.result.type === 'item_matches' || turn.result.type === 'expiry_list' || isAgentStatusResult(turn.result)) && (
          <p className={AGENT_FOOTNOTE}>{t('agent_result_disclaimer')}</p>
        )}
      </section>
    </div>
  );
}
