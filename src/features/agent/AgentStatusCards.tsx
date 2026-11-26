import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getCategoryDetails } from '../../utils/chemicalAnalyzer';
import { isDisposalCategory } from '../../utils/disposalCategories';
import { wasteStreamLabel } from '../../utils/wasteLabels';
import { describeLabAdminTask, formatMonthDay } from '../admin/labAdminTaskText';
import type { LabAdminTaskSeverity } from '../admin/labAdminTasks';
import type { CabinetLockGroup } from '../dailyInspection/labSafetySignals';
import { formatVolumeMl } from '../wasteContainers/containerSummary';
import { AgentCard, AgentGoButton, AgentNotice } from './AgentCardParts';
import { AGENT_CHIP, AGENT_NOTE, AGENT_ROW } from './agentCardStyles';
import { AGENT_WASTE_LOG_LIMIT } from './agentDataSources';
import type { AgentStatusResult, AgentUiAction, AgentWasteStreamRow } from './agentResults';

const SEVERITY_DOT: Record<LabAdminTaskSeverity, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  slate: 'bg-slate-400',
};

const ROW_TITLE = 'font-semibold text-slate-900 dark:text-slate-100';
const ROW_META = 'mt-0.5 text-sm text-slate-600 dark:text-slate-400';
const SUB_HEADING = 'mb-2 mt-4 text-sm font-medium text-slate-600 first:mt-0 dark:text-slate-400';

/** A timestamp as the month and day the person's own clock shows, e.g. "11/24". */
function localMonthDay(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}/${date.getDate()}`;
}

function streamRowLabel(row: AgentWasteStreamRow, t: TFunction, language: string): string {
  if (row.streamCode) return wasteStreamLabel(row.streamCode, language);
  return isDisposalCategory(row.category) ? t(getCategoryDetails(row.category).label) : row.category;
}

function LockGroups({ heading, groups, onUiAction }: {
  heading: string;
  groups: CabinetLockGroup[];
  onUiAction: (action: AgentUiAction) => void;
}) {
  const { t } = useTranslation();
  if (groups.length === 0) return null;
  return (
    <>
      <h4 className={SUB_HEADING}>{heading}</h4>
      <ul>
        {groups.map((group) => (
          <li key={group.cabinetId} className={`${AGENT_ROW} flex items-center justify-between gap-3`}>
            <div className="min-w-0">
              <p className={ROW_TITLE}>{group.cabinetName}</p>
              <p className={ROW_META}>{t('agent_locks_reagent_count', { count: group.count })}</p>
            </div>
            <AgentGoButton
              label={t('agent_open_cabinet')}
              onClick={() => onUiAction({ type: 'open_cabinet', cabinetId: group.cabinetId, itemId: null, shelfId: null })}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Cards for status questions. Like every agent result, they show values from
 * the lab's own records and fixed app copy only.
 */
export function AgentStatusCard({ result, onUiAction }: {
  result: AgentStatusResult;
  onUiAction: (action: AgentUiAction) => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const openScreen = (screen: 'inventory' | 'inspection' | 'purchases' | 'admin' | 'logs') => () => onUiAction({ type: 'open_screen', screen });
  const more = (hidden: number) => hidden > 0 && <p className={`mt-3 ${AGENT_NOTE}`}>{t('agent_more_items', { count: hidden })}</p>;

  if (result.type === 'low_stock') {
    const openInventory = <AgentGoButton label={t('agent_open_inventory')} onClick={openScreen('inventory')} />;
    if (result.inventoryCount === 0) {
      return <AgentNotice title={t('agent_inventory_empty_title')} actions={openInventory}>{t('agent_inventory_empty_desc')}</AgentNotice>;
    }
    const notes = [t('agent_low_stock_estimate'), !result.hasUsageHistory && t('agent_low_stock_no_history')];
    if (result.total === 0) return <AgentCard title={t('agent_low_stock_none')} notes={notes} actions={openInventory} />;
    return (
      <AgentCard title={t('agent_low_stock_title', { count: result.total })} notes={notes} actions={openInventory}>
        <ul>
          {result.forecasts.map((forecast) => (
            <li key={forecast.key} className={`${AGENT_ROW} flex items-start justify-between gap-3`}>
              <div className="min-w-0">
                <p className={ROW_TITLE}>{forecast.name}</p>
                <p className={ROW_META}>
                  {[
                    forecast.reason === 'pace' && forecast.daysLeft !== null
                      ? t('agent_low_stock_days_left', { days: forecast.daysLeft })
                      : t('agent_low_stock_last_bottle', { percent: forecast.lastBottlePercent ?? 0 }),
                    t('agent_low_stock_on_hand', { count: forecast.onHand }),
                    forecast.capacity,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold ${forecast.level === 'low'
                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                {t(`agent_low_stock_level_${forecast.level}`)}
              </span>
            </li>
          ))}
        </ul>
        {more(result.total - result.forecasts.length)}
      </AgentCard>
    );
  }

  if (result.type === 'regulated_list') {
    const openInventory = <AgentGoButton label={t('agent_open_inventory')} onClick={openScreen('inventory')} />;
    if (result.inventoryCount === 0) {
      return <AgentNotice title={t('agent_inventory_empty_title')} actions={openInventory}>{t('agent_inventory_empty_desc')}</AgentNotice>;
    }
    const notes = [
      result.withoutCasCount > 0 && t('agent_regulated_without_cas', { count: result.withoutCasCount }),
      result.unresolvedCount > 0 && t('agent_regulated_unresolved', { count: result.unresolvedCount }),
    ];
    if (result.total === 0) return <AgentCard title={t('agent_regulated_none')} notes={notes} actions={openInventory} />;
    return (
      <AgentCard title={t('agent_regulated_title', { count: result.total })} notes={notes} actions={openInventory}>
        <ul>
          {result.substances.map((substance) => (
            <li key={substance.casNumber} className={AGENT_ROW}>
              <p className={ROW_TITLE}>{substance.name}</p>
              <p className={ROW_META}>CAS {substance.casNumber} · {t('agent_regulated_item_count', { count: substance.itemCount })}</p>
              <p className="mt-1.5 flex flex-wrap gap-1.5">
                {substance.classes.map((name) => <span key={name} className={AGENT_CHIP}>{name}</span>)}
              </p>
            </li>
          ))}
        </ul>
        {more(result.total - result.substances.length)}
        {result.obligations.length > 0 && (
          <>
            <h4 className={SUB_HEADING}>{t('agent_regulated_obligations_title')}</h4>
            <ul className="flex flex-col gap-2">
              {result.obligations.map((obligation) => (
                <li key={obligation.id} className="text-sm leading-6 text-slate-700 dark:text-slate-300">
                  {language.startsWith('ko') ? obligation.text.ko : obligation.text.en}
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{obligation.source.citation}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">{t('agent_regulated_basis')}</p>
      </AgentCard>
    );
  }

  if (result.type === 'cabinet_locks') {
    const count = result.unlocked.length + result.unset.length;
    if (count === 0) return <AgentNotice title={t('agent_locks_none')} />;
    return (
      <AgentCard title={t('agent_locks_title', { count })} notes={[t('admin_overview_cabinet_lock_basis')]}>
        <LockGroups heading={t('agent_locks_unlocked_heading')} groups={result.unlocked} onUiAction={onUiAction} />
        <LockGroups heading={t('agent_locks_unset_heading')} groups={result.unset} onUiAction={onUiAction} />
      </AgentCard>
    );
  }

  if (result.type === 'inspection_gaps') {
    const notes = [
      t(result.recordedToday ? 'agent_inspection_today_done' : 'agent_inspection_today_missing'),
      t('agent_inspection_scope', { days: result.lookbackDays }),
    ];
    const openInspection = <AgentGoButton label={t('agent_open_inspection')} onClick={openScreen('inspection')} />;
    if (result.missingDates.length === 0) {
      return <AgentCard title={t('agent_inspection_none', { days: result.lookbackDays })} notes={notes} actions={openInspection} />;
    }
    return (
      <AgentCard title={t('agent_inspection_title', { count: result.missingDates.length })} notes={notes} actions={openInspection}>
        <p className="flex flex-wrap gap-1.5">
          {result.missingDates.map((date) => <span key={date} className={AGENT_CHIP}>{formatMonthDay(date)}</span>)}
        </p>
      </AgentCard>
    );
  }

  if (result.type === 'purchase_status') {
    const openPurchases = <AgentGoButton label={t('agent_open_purchases')} onClick={openScreen('purchases')} />;
    const count = result.requested + result.approved + result.ordered;
    if (count === 0) return <AgentNotice title={t('agent_purchase_none')} actions={openPurchases} />;
    return (
      <AgentCard title={t('agent_purchase_title', { count })} actions={openPurchases}>
        <dl className="grid grid-cols-3 gap-1.5">
          {(['requested', 'approved', 'ordered'] as const).map((status) => (
            <div key={status} className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-900/50">
              <dt className="text-2xs font-medium text-slate-500 dark:text-slate-400">{t(`agent_purchase_${status}`)}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">{result[status]}</dd>
            </div>
          ))}
        </dl>
        {result.waiting.length > 0 && (
          <>
            <h4 className={SUB_HEADING}>{t('agent_purchase_waiting_heading')}</h4>
            <ul>
              {result.waiting.map((request) => (
                <li key={request.id} className={`${AGENT_ROW} flex items-center justify-between gap-3`}>
                  <span className={`min-w-0 ${ROW_TITLE}`}>{request.itemName}</span>
                  <span className="shrink-0 text-sm text-slate-600 dark:text-slate-400">
                    {[t('agent_purchase_quantity', { count: request.quantity }), localMonthDay(request.createdAt)].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {more(result.requested - result.waiting.length)}
      </AgentCard>
    );
  }

  if (result.type === 'admin_tasks') {
    const openAdmin = <AgentGoButton label={t('agent_open_admin')} onClick={openScreen('admin')} />;
    const notes = [
      result.failedSourceCount > 0 && t('agent_admin_tasks_failed'),
      result.snoozedCount > 0 && t('agent_admin_tasks_snoozed', { count: result.snoozedCount }),
    ];
    if (result.total === 0) return <AgentCard title={t('agent_admin_tasks_none')} notes={notes} actions={openAdmin} />;
    return (
      <AgentCard title={t('agent_admin_tasks_title', { count: result.total })} notes={notes} actions={openAdmin}>
        <ul>
          {result.tasks.map((task) => {
            const text = describeLabAdminTask(task, t, language);
            return (
              <li key={task.key} className={`${AGENT_ROW} flex items-start gap-2.5`}>
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[task.severity]}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className={ROW_TITLE}>{text.title}</p>
                  {text.meta && <p className={ROW_META}>{text.meta}</p>}
                  {text.detail && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{text.detail}</p>}
                </div>
              </li>
            );
          })}
        </ul>
        {more(result.total - result.tasks.length)}
      </AgentCard>
    );
  }

  const openLogs = <AgentGoButton label={t('agent_open_logs')} onClick={openScreen('logs')} />;

  if (result.type === 'container_status') {
    if (result.containers.length === 0) return <AgentNotice title={t('agent_containers_none')} actions={openLogs} />;
    const notes = [result.containers.some((container) => container.hasUnknownAmounts) && t('agent_container_unknown_amounts')];
    return (
      <AgentCard title={t('agent_containers_title', { count: result.containers.length })} notes={notes} actions={openLogs}>
        <ul>
          {result.containers.map((container) => (
            <li key={container.id} className={`${AGENT_ROW} flex items-start justify-between gap-3`}>
              <div className="min-w-0">
                <p className={ROW_TITLE}>{container.label}</p>
                <p className={ROW_META}>
                  {[wasteStreamLabel(container.streamCode, language), container.location].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className={AGENT_CHIP}>{t(`agent_container_${container.status}`)}</span>
                  {container.pickupRequested && (
                    <span className="inline-block rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      {t('agent_container_pickup')}
                    </span>
                  )}
                </p>
              </div>
              <span className="shrink-0 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">
                {container.fillPercent !== null
                  ? t('agent_container_fill', { percent: container.fillPercent, volume: formatVolumeMl(container.totalMl) })
                  : formatVolumeMl(container.totalMl)}
              </span>
            </li>
          ))}
        </ul>
      </AgentCard>
    );
  }

  const period = t(`agent_waste_period_${result.period}`);
  if (result.logCount === 0) return <AgentNotice title={t('agent_waste_none', { period })} actions={openLogs} />;
  return (
    <AgentCard
      title={t('agent_waste_title', { period, count: result.logCount })}
      notes={[
        t('agent_waste_total_volume', { volume: formatVolumeMl(result.totalVolumeMl) }),
        result.truncated && t('agent_waste_truncated', { count: AGENT_WASTE_LOG_LIMIT }),
      ]}
      actions={openLogs}
    >
      <ul>
        {result.streams.map((row) => (
          <li key={`${row.streamCode ?? ''}:${row.category}`} className={`${AGENT_ROW} flex items-start justify-between gap-3`}>
            <div className="min-w-0">
              <p className={ROW_TITLE}>{streamRowLabel(row, t, language)}</p>
              <p className={ROW_META}>
                {[
                  t('agent_waste_row_count', { count: row.count }),
                  row.withoutVolumeCount > 0 && t('agent_waste_without_volume', { count: row.withoutVolumeCount }),
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-slate-900 dark:text-slate-100">{formatVolumeMl(row.volumeMl)}</span>
          </li>
        ))}
      </ul>
    </AgentCard>
  );
}
