import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, ArrowRight, Box, ChevronRight, Loader2, MapPin, RotateCcw, Search, Sparkles } from 'lucide-react';
import type { InventoryItem } from '../../services/inventoryService';
import type { AgentStatus, AgentTurn } from '../../store/useAgentStore';
import { getExpiryBadgeClasses, getExpiryStatus, type ExpiryStatus } from '../../utils/expiryStatus';
import { AgentNotice } from './AgentCardParts';
import { AgentStatusCard } from './AgentStatusCards';
import {
  AGENT_CARD,
  AGENT_LINK_BUTTON,
  AGENT_PRIMARY_BUTTON,
  AGENT_SECONDARY_BUTTON,
} from './agentCardStyles';
import { isAgentStatusCapabilityId, type AgentFacet } from './agentContract';
import { isAgentStatusResult, type AgentErrorKind, type AgentResult, type AgentRunnablePlan, type AgentUiAction } from './agentResults';
import { inventoryFilterForWindow } from './executors/expiryList';

interface AgentResultViewProps {
  status: AgentStatus;
  turn: AgentTurn | null;
  onUiAction: (action: AgentUiAction) => void;
  onExample: (text: string) => void;
  onRetry: () => void;
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
  if (isAgentStatusCapabilityId(plan.kind) || plan.kind === 'container_status') return t(`agent_interpreted_${plan.kind}`);
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

function Fact({ label, emphasized, children }: { label: string; emphasized: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 rounded-lg px-2.5 py-1.5 ${emphasized
      ? 'bg-blue-50 dark:bg-blue-950/40'
      : 'bg-slate-50 dark:bg-slate-900/50'}`}>
      <dt className="text-2xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`mt-0.5 min-w-0 text-sm ${emphasized
        ? 'font-semibold text-slate-900 dark:text-slate-100'
        : 'text-slate-700 dark:text-slate-300'}`}>{children}</dd>
    </div>
  );
}

function ExpiryBadge({ status, t }: { status: ExpiryStatus; t: TFunction }) {
  return (
    <span className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold ${getExpiryBadgeClasses(status.level).replace('animate-pulse', '')}`}>
      {t(status.labelKey, status.labelParams)}
    </span>
  );
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
    <li className="border-t border-slate-100 py-3 first:border-t-0 first:pt-0 last:pb-0 dark:border-slate-700/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 dark:text-slate-100">{item.name}</p>
          {detail && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
        </div>
        {action && (
          <button
            type="button"
            onClick={() => onUiAction(action)}
            aria-label={`${item.name} · ${t('agent_open_cabinet')}`}
            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
          >
            <Box className="h-3.5 w-3.5" aria-hidden="true" />
            {t('agent_open_cabinet')}
            <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
          </button>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        <Fact label={t('agent_fact_location')} emphasized={facet === 'location'}>
          <span className="flex min-w-0 items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="min-w-0">{locationLabel(item, t)}</span>
          </span>
        </Fact>
        <Fact label={t('agent_fact_remaining')} emphasized={facet === 'remaining'}>
          {typeof item.remaining_percent === 'number'
            ? t('agent_remaining_percent', { percent: item.remaining_percent })
            : t('agent_value_missing')}
        </Fact>
        <Fact label={t('agent_fact_expiry')} emphasized={facet === 'expiry'}>
          {expiry && item.expiry_date
            ? <span className="flex flex-wrap items-center gap-1.5">{item.expiry_date}<ExpiryBadge status={expiry} t={t} /></span>
            : t('agent_value_missing')}
        </Fact>
      </dl>
    </li>
  );
}

function ResultBlock({ result, onUiAction, onExample }: {
  result: AgentResult;
  onUiAction: (action: AgentUiAction) => void;
  onExample: (text: string) => void;
}) {
  const { t } = useTranslation();
  const openInventory = (
    <button type="button" className={AGENT_SECONDARY_BUTTON} onClick={() => onUiAction({ type: 'open_screen', screen: 'inventory' })}>
      {t('agent_open_inventory')}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  if (isAgentStatusResult(result)) return <AgentStatusCard result={result} onUiAction={onUiAction} />;

  if (result.type === 'item_matches') {
    return (
      <section className={AGENT_CARD}>
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
          {t('agent_item_matches_title', { query: result.query, count: result.items.length + result.hiddenCount })}
        </h3>
        {result.aliasOnly && (
          <p className="mt-1.5 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('agent_item_alias_notice')}</span>
          </p>
        )}
        <ul className="mt-3">
          {result.items.map((item) => (
            <ItemRow key={`${item._source ?? 'inventory'}:${item.id}`} item={item} facet={result.facet} onUiAction={onUiAction} />
          ))}
        </ul>
        {result.hiddenCount > 0 && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t('agent_more_items', { count: result.hiddenCount })}</p>
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
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
          {t(result.total > 0 ? `agent_expiry_title_${result.window}` : `agent_expiry_none_${result.window}`, { count: result.total })}
        </h3>
        {result.undatedCount > 0 && (
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            {t('agent_expiry_undated', { count: result.undatedCount })}
          </p>
        )}
        {result.rows.length > 0 && (
          <ul className="mt-3">
            {result.rows.map(({ item }) => (
              <ItemRow key={`${item._source ?? 'inventory'}:${item.id}`} item={item} facet="expiry" onUiAction={onUiAction} />
            ))}
          </ul>
        )}
        {hiddenCount > 0 && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t('agent_more_items', { count: hiddenCount })}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={AGENT_SECONDARY_BUTTON}
            onClick={() => onUiAction({ type: 'open_inventory', filter: result.total > 0 ? filter : null })}
          >
            {t(result.total > 0 ? 'agent_open_inventory_filtered' : 'agent_open_inventory')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
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
export function AgentResultView({ status, turn, onUiAction, onExample, onRetry }: AgentResultViewProps) {
  const { t } = useTranslation();

  if (!turn) {
    return (
      <section className="flex flex-col gap-3" data-agent-result="idle">
        {/* Wide and desktop layouts already show this copy as the page heading. */}
        <div className="agent-intro-copy flex items-start gap-2.5 wide:hidden">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">{t('agent_heading_title')}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{t('agent_heading_desc')}</p>
          </div>
        </div>
        <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{t('agent_intro_note')}</p>
        <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">{t('agent_examples_label')}</h3>
        <ul className="flex flex-wrap gap-2">
          {EXAMPLE_KEYS.map((key) => (
            <li key={key} className="min-w-0 max-w-full">
              <button
                type="button"
                onClick={() => onExample(t(key))}
                className="inline-flex min-h-9 max-w-full items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-700 dark:hover:text-blue-300"
              >
                <span className="truncate">{t(key)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const interpreted = interpretedLabel(turn.plan, t);

  return (
    <section className="flex flex-col gap-3" data-agent-result={status === 'idle' ? 'done' : status} aria-live="polite">
      {interpreted && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('agent_interpreted_as')} <span className="font-semibold text-slate-700 dark:text-slate-300">{interpreted}</span>
        </p>
      )}

      {status !== 'idle' && (
        <div role="status" className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          <span className="font-medium">{t(status === 'planning' ? 'agent_status_planning' : 'agent_status_running')}</span>
        </div>
      )}

      {turn.error && (
        <div role="alert" className="flex items-start gap-3 text-sm">
          <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="leading-6 text-slate-600 dark:text-slate-400">{t(`agent_error_${turn.error}`)}</p>
            {RETRYABLE_ERRORS.has(turn.error) && (
              <button type="button" onClick={onRetry} className={AGENT_LINK_BUTTON}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t('search_retry')}
              </button>
            )}
          </div>
        </div>
      )}

      {turn.result && <ResultBlock result={turn.result} onUiAction={onUiAction} onExample={onExample} />}

      {turn.result && (turn.result.type === 'item_matches' || turn.result.type === 'expiry_list' || isAgentStatusResult(turn.result)) && (
        <p className="text-xs text-slate-400 dark:text-slate-500">{t('agent_result_disclaimer')}</p>
      )}
    </section>
  );
}
