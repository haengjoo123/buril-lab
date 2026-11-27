import { lazy, Suspense, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { InventoryItem, StorageLocation } from '../../services/inventoryService';
import { wasteStreamLabel } from '../../utils/wasteLabels';
import type { InventoryFormSaveResult } from '../inventory/InventoryFormModal';
import { QuantityStepper } from '../inventory/QuantityStepper';
import { INVENTORY_REMAINING_LEVELS, getInventoryRemainingStage } from '../inventory/remainingLevels';
import { formatVolumeMl } from '../wasteContainers/containerSummary';
import { actionErrorKindOf, type AgentActions, type AgentWasteBatchAddition } from './agentActions';
import { AgentAnnouncer, AgentGoButton, AgentNotice } from './AgentCardParts';
import {
  AGENT_BODY,
  AGENT_CARD,
  AGENT_CARD_TITLE,
  AGENT_CHIP,
  AGENT_CHOICE,
  AGENT_CHOICE_IDLE,
  AGENT_CHOICE_INPUT,
  AGENT_CHOICE_SELECTED,
  AGENT_FIELD_LABEL,
  AGENT_FOOTNOTE,
  AGENT_NOTE,
  AGENT_PRIMARY_BUTTON,
  AGENT_QUIET_BUTTON,
  AGENT_ROW_META,
  AGENT_SCALE_STEP,
  AGENT_SCALE_STEP_IDLE,
  AGENT_SCALE_STEP_SELECTED,
  AGENT_SPINNER,
  AGENT_STATUS_ERROR,
  AGENT_STATUS_SUCCESS,
  AGENT_VALUE,
} from './agentCardStyles';
import { AGENT_MAX_QUANTITY } from './agentContract';
import { focusOnMount } from './agentFocus';
import type {
  AgentActionErrorKind,
  AgentProposalResult,
  AgentUiAction,
  AgentWasteComponentLookup,
  AgentWasteComponentRow,
} from './agentResults';
import { inventoryRowId } from './executors/proposals';
import type { ParsedWasteAmount } from './parseWasteComponents';

// The registration form is large and only opens from one proposal.
const InventoryFormModal = lazy(() => import('../inventory/InventoryFormModal').then((module) => ({ default: module.InventoryFormModal })));

interface ProposalProps<T extends AgentProposalResult['type']> {
  result: Extract<AgentProposalResult, { type: T }>;
  actions: AgentActions;
  onUiAction: (action: AgentUiAction) => void;
  /** Leaves the proposal without saving anything. */
  onDismiss: () => void;
  /** The proposal was confirmed and saved. */
  onConfirmed: () => void;
}

type SaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'done' }
  | { phase: 'error'; kind: AgentActionErrorKind };

/** Runs the save a confirmed proposal asks for, once at a time. */
function useProposalSave(onConfirmed: () => void) {
  const [state, setState] = useState<SaveState>({ phase: 'idle' });
  // Two presses can arrive before the first one re-renders the button as busy.
  const inFlight = useRef(false);

  const save = async (task: () => Promise<void>) => {
    if (inFlight.current || state.phase === 'done') return;
    inFlight.current = true;
    setState({ phase: 'saving' });
    try {
      await task();
      onConfirmed();
      setState({ phase: 'done' });
    } catch (error) {
      setState({ phase: 'error', kind: actionErrorKindOf(error) });
    } finally {
      inFlight.current = false;
    }
  };

  return { state, save, markDone: () => setState({ phase: 'done' }) };
}

/**
 * The shared frame of a proposal: what would be recorded, the one button that
 * records it, and the way out. Once saved, only the outcome remains.
 */
function ProposalCard({
  title, notes, children, summary, state, confirmLabel, blockedReason, onConfirm, onDismiss, doneText, doneActions,
  progress = '', isSavedOnConfirm = true,
}: {
  title: string;
  notes?: Array<string | null | false>;
  children?: ReactNode;
  /** One sentence stating exactly what confirming will record. */
  summary: string | null;
  state: SaveState;
  confirmLabel: string;
  /** Why the proposal cannot be confirmed yet; shown, and read out with the button. */
  blockedReason: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
  doneText: string;
  doneActions?: ReactNode;
  /** Something under way inside the card, in words, for a screen reader. */
  progress?: string;
  /** False when the button only opens a form that has its own save. */
  isSavedOnConfirm?: boolean;
}) {
  const { t } = useTranslation();
  const summaryId = useId();
  const shownNotes = (notes ?? []).filter((note): note is string => Boolean(note));
  const isDone = state.phase === 'done';
  const isSaving = state.phase === 'saving';
  const errorText = state.phase === 'error' ? t(`agent_proposal_error_${state.kind}`) : '';

  return (
    <section className={AGENT_CARD} data-agent-proposal={state.phase} aria-busy={isSaving}>
      <AgentAnnouncer
        status={isDone ? doneText : isSaving ? t('agent_proposal_saving') : progress}
        alert={errorText}
      />
      <h3 className={AGENT_CARD_TITLE}>{title}</h3>
      {isDone ? (
        <>
          {/* The buttons that had the focus are gone, so the outcome takes it. */}
          <p tabIndex={-1} ref={focusOnMount} className={`mt-4 ${AGENT_STATUS_SUCCESS}`}>
            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{doneText}</span>
          </p>
          {doneActions && <div className="mt-4 flex flex-wrap gap-2">{doneActions}</div>}
        </>
      ) : (
        <>
          {shownNotes.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {shownNotes.map((note) => <p key={note} className={AGENT_NOTE}>{note}</p>)}
            </div>
          )}
          {children && <div className="mt-4 flex flex-col gap-4">{children}</div>}
          <p id={summaryId} className={`mt-4 ${AGENT_BODY}`}>
            {summary ?? blockedReason}
          </p>
          {errorText && (
            <p className={`mt-3 ${AGENT_STATUS_ERROR}`}>
              <AlertCircle className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorText}</span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/*
              While saving, the button stays focusable and keeps its size: it is marked busy and
              ignores further presses instead of being disabled, which would drop the focus.
            */}
            <button
              type="button"
              className={AGENT_PRIMARY_BUTTON}
              disabled={Boolean(blockedReason)}
              aria-disabled={isSaving || undefined}
              aria-busy={isSaving || undefined}
              aria-describedby={summaryId}
              onClick={isSaving ? undefined : onConfirm}
            >
              <span className={isSaving ? 'opacity-0' : undefined}>{confirmLabel}</span>
              {isSaving && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className={AGENT_SPINNER} aria-hidden="true" />
                </span>
              )}
            </button>
            <button
              type="button"
              className={AGENT_QUIET_BUTTON}
              aria-disabled={isSaving || undefined}
              onClick={isSaving ? undefined : onDismiss}
            >
              {t('agent_proposal_cancel')}
            </button>
          </div>
          {isSavedOnConfirm && (
            <p className={`mt-2 ${AGENT_FOOTNOTE}`}>{t('agent_proposal_nothing_saved')}</p>
          )}
        </>
      )}
    </section>
  );
}

interface Choice {
  id: string;
  title: string;
  meta?: string | null;
  detail?: string | null;
}

/** A single-choice list. Nothing is picked on the person's behalf when there is more than one. */
function ChoiceList({ legend, choices, value, onChange, isDisabled, isBusy = false }: {
  legend: string;
  choices: Choice[];
  value: string | null;
  onChange: (id: string) => void;
  isDisabled: boolean;
  /** A choice is being looked up: the options stay focusable and ignore further picks. */
  isBusy?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={isDisabled} aria-busy={isBusy} className="min-w-0">
      <legend className={AGENT_FIELD_LABEL}>{legend}</legend>
      <div className="-mx-3 mt-1 flex flex-col gap-1">
        {choices.map((choice) => {
          const isSelected = choice.id === value;
          return (
            <label key={choice.id} className={`${AGENT_CHOICE} ${isSelected ? AGENT_CHOICE_SELECTED : AGENT_CHOICE_IDLE}`}>
              <input
                type="radio"
                name={name}
                value={choice.id}
                checked={isSelected}
                onChange={() => onChange(choice.id)}
                className={AGENT_CHOICE_INPUT}
              />
              <span className="min-w-0">
                <span className={`block ${AGENT_VALUE}`}>{choice.title}</span>
                {choice.meta && <span className={`block ${AGENT_ROW_META}`}>{choice.meta}</span>}
                {choice.detail && <span className={`block ${AGENT_ROW_META}`}>{choice.detail}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const itemKey = (item: InventoryItem) => `${item._source ?? 'inventory'}:${item.id}`;

function itemLocation(item: InventoryItem, t: TFunction): string {
  if (item.storage_type === 'cabinet' && item.cabinet_name) {
    return typeof item.shelf_level === 'number'
      ? `${item.cabinet_name} · ${t('cabinet_shelf_level', { level: item.shelf_level + 1 })}`
      : item.cabinet_name;
  }
  return item.storage_location_name || t('agent_location_missing');
}

function itemChoice(item: InventoryItem, t: TFunction): Choice {
  return {
    id: itemKey(item),
    title: item.name,
    meta: [item.brand, item.capacity, itemLocation(item, t)].filter(Boolean).join(' · '),
    detail: typeof item.remaining_percent === 'number'
      ? t('agent_usage_current', { percent: item.remaining_percent })
      : null,
  };
}

function UsageProposal({ result, actions, onUiAction, onDismiss, onConfirmed }: ProposalProps<'usage_proposal'>) {
  const { t } = useTranslation();
  const { state, save } = useProposalSave(onConfirmed);
  const isUsedUp = result.change.kind === 'used_up';
  // One record is the answer; several are a question for the person.
  const [selectedKey, setSelectedKey] = useState<string | null>(result.items.length === 1 ? itemKey(result.items[0]) : null);
  const [percent, setPercent] = useState<number | null>(result.change.kind === 'remaining' ? result.change.percent : null);
  const requestId = useRef<string | null>(null);
  const levelName = useId();
  const selected = result.items.find((item) => itemKey(item) === selectedKey) ?? null;
  // Only a bottle on a cabinet shelf has the record the used-up path writes to.
  const isRecordable = !isUsedUp || selected?._source === 'cabinet_item';
  const isSaving = state.phase === 'saving';

  const blockedReason = !selected
    ? t('agent_proposal_choose_item_hint', { count: result.items.length })
    : !isRecordable
      ? t('agent_usage_used_up_cabinet_only')
      : !isUsedUp && percent === null
        ? t('agent_usage_need_level')
        : null;
  const summary = blockedReason || !selected
    ? null
    : isUsedUp
      ? t('agent_usage_summary_used_up', { name: selected.name })
      : t('agent_usage_summary_remaining', { name: selected.name, percent });

  const confirm = () => {
    if (!selected || blockedReason) return;
    void save(async () => {
      if (isUsedUp) {
        // Kept across retries so a repeated press cannot use up two bottles.
        requestId.current ??= actions.newRequestId();
        await actions.recordUsedUp(result.labId, selected.id, requestId.current);
      } else if (percent !== null) {
        await actions.setRemaining(result.labId, selected, percent);
      }
    });
  };

  return (
    <ProposalCard
      title={t(isUsedUp ? 'agent_usage_title_used_up' : 'agent_usage_title_remaining')}
      notes={[
        result.aliasOnly && t('agent_item_alias_notice'),
        result.hiddenCount > 0 && t('agent_more_items', { count: result.hiddenCount }),
      ]}
      summary={summary}
      state={state}
      confirmLabel={t(isUsedUp ? 'agent_usage_confirm_used_up' : 'agent_usage_confirm_remaining')}
      blockedReason={blockedReason}
      onConfirm={confirm}
      onDismiss={onDismiss}
      doneText={isUsedUp ? t('agent_usage_done_used_up') : t('agent_usage_done_remaining', { percent })}
      doneActions={<AgentGoButton label={t('agent_open_inventory')} onClick={() => onUiAction({ type: 'open_screen', screen: 'inventory' })} />}
    >
      <ChoiceList
        legend={t('agent_proposal_choose_item')}
        choices={result.items.map((item) => itemChoice(item, t))}
        value={selectedKey}
        onChange={setSelectedKey}
        isDisabled={isSaving}
      />
      {!isUsedUp && (
        // Native radios, so the arrow keys move along the scale and Tab stops on it once.
        <fieldset disabled={isSaving} className="min-w-0">
          <legend className={AGENT_FIELD_LABEL}>{t('agent_usage_level_label')}</legend>
          {/* Two by two in a narrow card, so a long label is never broken inside a word. */}
          <div className="mt-2 grid grid-cols-2 gap-2 @sm:grid-cols-4">
            {INVENTORY_REMAINING_LEVELS.map((level) => {
              const isSelected = percent !== null && level.stage === getInventoryRemainingStage(percent);
              return (
                <label
                  key={level.stage}
                  className={`${AGENT_SCALE_STEP} ${isSelected ? AGENT_SCALE_STEP_SELECTED : AGENT_SCALE_STEP_IDLE}`}
                >
                  <input
                    type="radio"
                    name={levelName}
                    className="sr-only"
                    checked={isSelected}
                    onChange={() => setPercent(level.value)}
                  />
                  {t(`inventory_remaining_stage_${level.stage}_label`)}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {isUsedUp && selected && !isRecordable && (
        <div>
          <AgentGoButton label={t('agent_open_inventory')} onClick={() => onUiAction({ type: 'open_screen', screen: 'inventory' })} />
        </div>
      )}
    </ProposalCard>
  );
}

const NO_LINK = 'none';

function PurchaseProposal({ result, actions, onUiAction, onDismiss, onConfirmed }: ProposalProps<'purchase_proposal'>) {
  const { t } = useTranslation();
  const { state, save } = useProposalSave(onConfirmed);
  const [quantity, setQuantity] = useState(result.quantity ?? 1);
  const [linkKey, setLinkKey] = useState<string>(result.matches.length === 1 ? itemKey(result.matches[0]) : NO_LINK);
  const linked = result.matches.find((item) => itemKey(item) === linkKey) ?? null;
  const count = Math.min(AGENT_MAX_QUANTITY, Math.max(1, quantity));
  const quantityId = useId();
  const isSaving = state.phase === 'saving';

  const confirm = () => {
    void save(() => actions.requestPurchase(result.labId, {
      itemName: result.itemName,
      quantity: count,
      // Details come only from the inventory record the person chose to link.
      brand: linked?.brand ?? null,
      productNumber: linked?.product_number ?? null,
      casNumber: linked?.cas_number ?? null,
      packageSize: linked?.capacity ?? null,
      sourceInventoryId: linked ? inventoryRowId(linked) : null,
    }));
  };

  return (
    <ProposalCard
      title={t('agent_purchase_proposal_title')}
      summary={t('agent_purchase_proposal_summary', { name: result.itemName, count })}
      state={state}
      confirmLabel={t('agent_purchase_proposal_confirm')}
      blockedReason={null}
      onConfirm={confirm}
      onDismiss={onDismiss}
      doneText={t('agent_purchase_proposal_done')}
      doneActions={<AgentGoButton label={t('agent_open_purchases')} onClick={() => onUiAction({ type: 'open_screen', screen: 'purchases' })} />}
    >
      <dl>
        <dt className={AGENT_FIELD_LABEL}>{t('agent_register_fact_name')}</dt>
        <dd className={`mt-1 ${AGENT_VALUE}`}>{result.itemName}</dd>
      </dl>
      <div>
        <label htmlFor={quantityId} className={AGENT_FIELD_LABEL}>{t('agent_purchase_proposal_quantity')}</label>
        <QuantityStepper
          id={quantityId}
          value={count}
          onChange={(next) => setQuantity(Math.min(AGENT_MAX_QUANTITY, next))}
          disabled={isSaving}
          className="mt-2 h-11 w-36 rounded-lg"
        />
      </div>
      {result.matches.length > 0 && (
        <div>
          <ChoiceList
            legend={t('agent_purchase_proposal_link_legend')}
            choices={[
              ...result.matches.map((item) => ({ ...itemChoice(item, t), detail: null })),
              { id: NO_LINK, title: t('agent_purchase_proposal_link_none') },
            ]}
            value={linkKey}
            onChange={setLinkKey}
            isDisabled={isSaving}
          />
          <p className={`mt-2 ${AGENT_NOTE}`}>{t('agent_purchase_proposal_link_hint')}</p>
        </div>
      )}
    </ProposalCard>
  );
}

function RegisterProposal({ result, actions, onUiAction, onDismiss, onConfirmed }: ProposalProps<'register_proposal'>) {
  const { t } = useTranslation();
  const { state, markDone } = useProposalSave(onConfirmed);
  const [locations, setLocations] = useState<StorageLocation[] | null>(null);
  const [isNotPlaced, setIsNotPlaced] = useState(false);
  const { draft } = result;
  const facts: Array<[string, string]> = [[t('agent_register_fact_name'), draft.name]];
  if (draft.quantity !== null) facts.push([t('agent_register_fact_quantity'), String(draft.quantity)]);
  if (draft.capacity) facts.push([t('agent_register_fact_capacity'), draft.capacity]);
  if (draft.casNumber) facts.push([t('agent_register_fact_cas'), draft.casNumber]);

  // Opening the form saves nothing: the form's own save button does.
  const openForm = async () => {
    try {
      setLocations(await actions.loadLocations());
    } catch {
      setLocations([]);
    }
  };

  const handleSaved = (saved: InventoryFormSaveResult) => {
    setLocations(null);
    onConfirmed();
    markDone();
    void saved.placement?.then((isPlaced) => {
      if (!isPlaced) setIsNotPlaced(true);
    });
  };

  return (
    <>
      <ProposalCard
        title={t('agent_register_title')}
        notes={[t('agent_register_note')]}
        summary={t('agent_register_summary', { name: draft.name })}
        state={state}
        confirmLabel={t('agent_register_open')}
        isSavedOnConfirm={false}
        blockedReason={null}
        onConfirm={() => void openForm()}
        onDismiss={onDismiss}
        doneText={isNotPlaced ? t('agent_register_no_space') : t('agent_register_done')}
        doneActions={<AgentGoButton label={t('agent_open_inventory')} onClick={() => onUiAction({ type: 'open_screen', screen: 'inventory' })} />}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @md:grid-cols-4">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className={AGENT_FIELD_LABEL}>{label}</dt>
              <dd className={`mt-1 ${AGENT_VALUE}`}>{value}</dd>
            </div>
          ))}
        </dl>
      </ProposalCard>
      {locations && (
        <Suspense fallback={null}>
          <InventoryFormModal
            isOpen
            onClose={() => setLocations(null)}
            locations={locations}
            initialDraft={{
              name: draft.name,
              cas_number: draft.casNumber ?? undefined,
              quantity: draft.quantity ?? undefined,
              capacity: draft.capacity ?? undefined,
            }}
            onSaved={handleSaved}
          />
        </Suspense>
      )}
    </>
  );
}

function PickupProposal({ result, actions, onUiAction, onDismiss, onConfirmed }: ProposalProps<'pickup_proposal'>) {
  const { t, i18n } = useTranslation();
  const { state, save } = useProposalSave(onConfirmed);
  const [selectedId, setSelectedId] = useState<string | null>(result.containers.length === 1 ? result.containers[0].id : null);
  const selected = result.containers.find((container) => container.id === selectedId) ?? null;
  const alreadyRequested = result.requestedCount > 0 && t('agent_pickup_already_requested', { count: result.requestedCount });
  const openLogs = <AgentGoButton label={t('agent_open_logs')} onClick={() => onUiAction({ type: 'open_screen', screen: 'logs' })} />;

  if (result.containers.length === 0) {
    return <AgentNotice title={t('agent_pickup_none_title')} actions={openLogs}>{alreadyRequested || null}</AgentNotice>;
  }

  return (
    <ProposalCard
      title={t('agent_pickup_title')}
      notes={[alreadyRequested]}
      summary={selected ? t('agent_pickup_summary', { label: selected.label }) : null}
      state={state}
      confirmLabel={t('agent_pickup_confirm')}
      blockedReason={selected ? null : t('agent_pickup_choose')}
      onConfirm={() => {
        if (selected) void save(() => actions.requestPickup(result.labId, selected.id));
      }}
      onDismiss={onDismiss}
      doneText={t('agent_pickup_done')}
      doneActions={openLogs}
    >
      <ChoiceList
        legend={t('agent_pickup_legend')}
        choices={result.containers.map((container) => ({
          id: container.id,
          title: container.label,
          meta: [wasteStreamLabel(container.streamCode, i18n.language), container.location].filter(Boolean).join(' · '),
          detail: [
            t(`agent_container_${container.status}`),
            container.fillPercent !== null
              ? t('agent_container_fill', { percent: container.fillPercent, volume: formatVolumeMl(container.totalMl) })
              : formatVolumeMl(container.totalMl),
          ].join(' · '),
        }))}
        value={selectedId}
        onChange={setSelectedId}
        isDisabled={state.phase === 'saving'}
      />
    </ProposalCard>
  );
}

const AMOUNT_UNIT_LABEL: Record<ParsedWasteAmount['unit'], string> = { uL: 'µL', mL: 'mL', L: 'L', mg: 'mg', g: 'g', kg: 'kg' };
/** The number in the app's language, not the device's. */
const amountLabel = (amount: ParsedWasteAmount, language: string) => (
  `${new Intl.NumberFormat(language).format(amount.value)} ${AMOUNT_UNIT_LABEL[amount.unit]}`
);

type FoundRow = AgentWasteComponentRow & { lookup: Extract<AgentWasteComponentLookup, { status: 'found' }> };

function WasteBatchProposal({ result, actions, onUiAction, onDismiss, onConfirmed }: ProposalProps<'waste_batch_proposal'>) {
  const { t, i18n } = useTranslation();
  const { state, save } = useProposalSave(onConfirmed);
  // A form picked from several replaces that row's lookup.
  const [resolved, setResolved] = useState<Record<string, AgentWasteComponentLookup>>({});
  const [pendingForm, setPendingForm] = useState<{ key: string; name: string } | null>(null);
  // The row whose form was just looked up: its options are gone, so its result takes the focus.
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [existingCount] = useState(() => actions.wasteBatchSize());
  const [addedCount, setAddedCount] = useState(0);
  const isSaving = state.phase === 'saving';
  const openReview = () => onUiAction({ type: 'open_screen', screen: 'cart' });
  const reviewButton = <AgentGoButton label={t('agent_disposal_open_review')} onClick={openReview} />;
  const amountOf = (row: AgentWasteComponentRow) => amountLabel(row.amount, i18n.language);

  const rows = result.components.map((row) => ({ ...row, lookup: resolved[row.key] ?? row.lookup }));
  const foundRows = rows.filter((row): row is FoundRow => row.lookup.status === 'found');
  const missingRows = rows.filter((row) => row.lookup.status === 'not_found' || row.lookup.status === 'failed');
  const additions: AgentWasteBatchAddition[] = foundRows
    .filter((row) => !excluded.has(row.key))
    .map((row) => ({ typedName: row.typedName, analysis: row.lookup.analysis, verifiedByCas: row.lookup.verifiedByCas, amount: row.amount }));

  if (foundRows.length === 0 && rows.every((row) => row.lookup.status !== 'choose_form') && state.phase !== 'done') {
    // Reached after a pick when its options were the last thing in the card: the notice takes the focus they had.
    return (
      <AgentNotice title={t('agent_batch_none_title')} actions={reviewButton} hasInitialFocus={resolvedKey !== null}>
        {t('agent_batch_none_desc')}
      </AgentNotice>
    );
  }

  const pickForm = async (row: AgentWasteComponentRow, name: string) => {
    if (pendingForm) return;
    setPendingForm({ key: row.key, name });
    const lookup = await actions.lookupForm(name).catch((): AgentWasteComponentLookup => ({ status: 'failed' }));
    setResolved((current) => ({ ...current, [row.key]: lookup }));
    setResolvedKey(row.key);
    setPendingForm(null);
  };

  const confirm = () => {
    if (additions.length === 0) return;
    void save(async () => {
      await actions.addToWasteBatch(result.labId, additions);
      setAddedCount(additions.length);
      // The review is where everything about disposal is decided.
      openReview();
    });
  };

  return (
    <ProposalCard
      title={t('agent_batch_title')}
      notes={[
        t('agent_batch_note_scope'),
        existingCount > 0 && t('agent_batch_note_existing', { count: existingCount }),
        additions.some((addition) => !addition.verifiedByCas) && t('agent_batch_note_review'),
        additions.some((addition) => addition.amount.kind === 'mass') && t('agent_batch_note_mass'),
      ]}
      summary={additions.length > 0 ? t('agent_batch_summary', { count: additions.length }) : null}
      state={state}
      confirmLabel={t('agent_batch_confirm')}
      blockedReason={additions.length > 0 ? null : t('agent_batch_choose')}
      onConfirm={confirm}
      onDismiss={onDismiss}
      doneText={t('agent_batch_done', { count: addedCount })}
      doneActions={reviewButton}
      progress={pendingForm ? t('agent_batch_form_loading') : ''}
    >
      {foundRows.length > 0 && (
        <fieldset disabled={isSaving} className="min-w-0">
          <legend className={AGENT_FIELD_LABEL}>{t('agent_batch_legend')}</legend>
          <div className="-mx-3 mt-1 flex flex-col gap-1">
            {foundRows.map((row) => {
              const isIncluded = !excluded.has(row.key);
              const { chemical } = row.lookup.analysis;
              return (
                <label key={row.key} className={`${AGENT_CHOICE} ${isIncluded ? AGENT_CHOICE_SELECTED : AGENT_CHOICE_IDLE}`}>
                  <input
                    type="checkbox"
                    ref={row.key === resolvedKey ? focusOnMount : undefined}
                    checked={isIncluded}
                    onChange={() => setExcluded((current) => {
                      const next = new Set(current);
                      if (isIncluded) next.add(row.key); else next.delete(row.key);
                      return next;
                    })}
                    className={AGENT_CHOICE_INPUT}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={AGENT_VALUE}>{chemical.name}</span>
                      <span className={AGENT_CHIP}>
                        {t(row.lookup.verifiedByCas ? 'agent_batch_cas_verified' : 'agent_batch_needs_review')}
                      </span>
                    </span>
                    <span className={`block ${AGENT_ROW_META}`}>
                      {[
                        t('agent_batch_typed', { name: row.typedName, amount: amountOf(row) }),
                        chemical.casNumber && t('agent_batch_cas', { cas: chemical.casNumber }),
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {rows.filter((row) => row.lookup.status === 'choose_form').map((row) => {
        const isLookingUp = pendingForm?.key === row.key;
        return (
          <div key={row.key}>
            {/* While a pick is looked up the options stay in place and focusable; further picks are ignored. */}
            <ChoiceList
              legend={t('agent_batch_form_legend', { name: row.typedName, amount: amountOf(row) })}
              choices={row.lookup.status === 'choose_form'
                ? row.lookup.choices.map((choice) => ({ id: choice.name, title: choice.name, meta: choice.nameEn ?? null }))
                : []}
              value={isLookingUp ? pendingForm.name : null}
              onChange={(name) => void pickForm(row, name)}
              isDisabled={isSaving}
              isBusy={isLookingUp}
            />
            {isLookingUp && (
              <p className={`mt-2 flex items-center gap-2 ${AGENT_NOTE}`}>
                <Loader2 className={AGENT_SPINNER} aria-hidden="true" />
                {t('agent_batch_form_loading')}
              </p>
            )}
          </div>
        );
      })}
      {missingRows.length > 0 && (
        <ul className="flex flex-col gap-1">
          {missingRows.map((row) => (
            <li
              key={row.key}
              tabIndex={row.key === resolvedKey ? -1 : undefined}
              ref={row.key === resolvedKey ? focusOnMount : undefined}
              className={`flex items-start gap-2 ${AGENT_NOTE}`}
            >
              <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <span>{t(row.lookup.status === 'failed' ? 'agent_batch_failed' : 'agent_batch_not_found', { name: row.typedName })}</span>
            </li>
          ))}
        </ul>
      )}
    </ProposalCard>
  );
}

/**
 * Proposals to record something. Each shows the lab's own records and what
 * confirming would save; nothing is written until the person presses the button.
 */
export function AgentProposalCard({ result, ...rest }: {
  result: AgentProposalResult;
  actions: AgentActions;
  onUiAction: (action: AgentUiAction) => void;
  onDismiss: () => void;
  onConfirmed: () => void;
}) {
  if (result.type === 'usage_proposal') return <UsageProposal result={result} {...rest} />;
  if (result.type === 'purchase_proposal') return <PurchaseProposal result={result} {...rest} />;
  if (result.type === 'register_proposal') return <RegisterProposal result={result} {...rest} />;
  if (result.type === 'waste_batch_proposal') return <WasteBatchProposal result={result} {...rest} />;
  return <PickupProposal result={result} {...rest} />;
}
