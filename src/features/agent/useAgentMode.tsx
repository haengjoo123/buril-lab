import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  isCabinetLockRulesEnabled,
  isDailyInspectionEnabled,
  isPurchaseRequestsEnabled,
  isRegulationBatchEnabled,
  isWasteContainersEnabled,
} from '../../config/featureFlags';
import { focusCabinetItem } from '../../services/cabinetFocusService';
import { useAgentStore, type AgentSubmitOptions } from '../../store/useAgentStore';
import { useLabStore } from '../../store/useLabStore';
import { labAppRoute } from '../../utils/appRoutes';
import { INVENTORY_FILTER_PARAM } from '../inventory/inventoryExpiryFilter';
import { PURCHASES_PARAM } from '../purchaseRequests/purchaseLink';
import { AgentResultView } from './AgentResultView';
import type { AgentLanguage } from './agentContract';
import type { AgentScreen, AgentUiAction } from './agentResults';
import type { AgentRuntimeContext } from './capabilityRegistry';
import {
  AGENT_MODE_PARAM,
  AGENT_MODE_VALUE,
  type SearchAgentModeProps,
  type SearchBarMode,
} from './searchAgentMode';

interface UseAgentModeParams {
  /** Build flag and screen state: false keeps the search screen exactly as it was. */
  enabled: boolean;
  isSearchTab: boolean;
  searchParams: URLSearchParams;
  navigate: NavigateFunction;
  isAuthenticated: boolean;
  navigateToLogin: (returnTo?: string) => void;
  language: AgentLanguage;
  isAdmin: boolean;
  currentLabId: string | null;
  /** Runs the normal search, leaving agent mode. */
  onSearchChemical: (query: string) => void;
  onOpenWasteBatch: () => void;
  /** Which optional features are on. Defaults to this build's flags; the layout fixture sets its own. */
  features?: AgentFeatureAvailability;
}

export type AgentFeatureAvailability = Pick<
  AgentRuntimeContext,
  'dailyInspectionEnabled' | 'purchaseRequestsEnabled' | 'regulationBatchEnabled' | 'cabinetLockRulesEnabled' | 'wasteContainersEnabled'
>;

const BUILD_FEATURES: AgentFeatureAvailability = {
  dailyInspectionEnabled: isDailyInspectionEnabled,
  purchaseRequestsEnabled: isPurchaseRequestsEnabled,
  regulationBatchEnabled: isRegulationBatchEnabled,
  cabinetLockRulesEnabled: isCabinetLockRulesEnabled,
  wasteContainersEnabled: isWasteContainersEnabled,
};

const AGENT_ROUTE = `${labAppRoute()}?${AGENT_MODE_PARAM}=${AGENT_MODE_VALUE}`;

const SCREEN_ROUTES: Record<Exclude<AgentScreen, 'cart'>, string> = {
  inventory: labAppRoute('/inventory'),
  cabinet: labAppRoute('/cabinet'),
  admin: labAppRoute('/admin'),
  inspection: `${labAppRoute('/logs')}?view=inspection`,
  purchases: `${labAppRoute('/inventory')}?${PURCHASES_PARAM}=1`,
  logs: labAppRoute('/logs'),
};

/**
 * Agent mode for the search screen: reads the mode from the URL, runs requests
 * through the agent store, and carries out the navigation its results ask for.
 */
export function useAgentMode(params: UseAgentModeParams): SearchAgentModeProps | undefined {
  const { enabled, isSearchTab, searchParams, navigate, isAuthenticated, language, isAdmin, currentLabId } = params;
  const text = useAgentStore((state) => state.text);
  const status = useAgentStore((state) => state.status);
  const turn = useAgentStore((state) => state.turn);
  const setText = useAgentStore((state) => state.setText);
  const submit = useAgentStore((state) => state.submit);
  const reset = useAgentStore((state) => state.reset);

  // The shell passes fresh closures on every render; handlers below read the latest ones.
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  });

  const mode: SearchBarMode = enabled && isSearchTab && isAuthenticated
    && searchParams.get(AGENT_MODE_PARAM) === AGENT_MODE_VALUE ? 'agent' : 'search';

  // Results belong to one space and one account.
  const scopeKey = `${isAuthenticated ? 'user' : 'guest'}:${currentLabId ?? 'personal'}`;
  const previousScopeKey = useRef(scopeKey);
  useEffect(() => {
    if (previousScopeKey.current === scopeKey) return;
    previousScopeKey.current = scopeKey;
    reset();
  }, [reset, scopeKey]);

  const handleUiAction = useCallback((action: AgentUiAction) => {
    if (action.type === 'search_chemical') {
      latest.current.onSearchChemical(action.query);
      return;
    }
    if (action.type === 'open_cabinet') {
      const route = labAppRoute(`/cabinet?id=${action.cabinetId}`);
      if (!action.itemId) {
        navigate(route);
        return;
      }
      navigate(route, { state: { cabinetId: action.cabinetId, itemId: action.itemId } });
      void focusCabinetItem({ cabinetId: action.cabinetId, itemId: action.itemId, shelfId: action.shelfId });
      return;
    }
    if (action.type === 'open_inventory') {
      navigate(action.filter
        ? `${labAppRoute('/inventory')}?${INVENTORY_FILTER_PARAM}=${action.filter}`
        : labAppRoute('/inventory'));
      return;
    }
    if (action.screen === 'cart') {
      latest.current.onOpenWasteBatch();
      return;
    }
    navigate(SCREEN_ROUTES[action.screen]);
  }, [navigate]);

  const joinPasswordNeedsChange = useLabStore((state) => Boolean(
    state.myLabs.find((membership) => membership.lab_id === currentLabId)?.lab?.join_password_needs_change,
  ));
  const features = params.features ?? BUILD_FEATURES;
  const context = useMemo<AgentRuntimeContext>(() => ({
    labId: currentLabId,
    isAdmin,
    joinPasswordNeedsChange,
    ...features,
  }), [currentLabId, features, isAdmin, joinPasswordNeedsChange]);

  const submitOptions = useMemo<AgentSubmitOptions>(
    () => ({ language, context, onUiAction: handleUiAction }),
    [context, handleUiAction, language],
  );

  const handleModeChange = useCallback((next: SearchBarMode) => {
    if (next === 'search') {
      navigate(labAppRoute());
      return;
    }
    if (!latest.current.isAuthenticated) {
      latest.current.navigateToLogin(AGENT_ROUTE);
      return;
    }
    navigate(AGENT_ROUTE);
  }, [navigate]);

  const handleAskAgent = useCallback((sentence: string) => {
    if (!latest.current.isAuthenticated) {
      latest.current.navigateToLogin(AGENT_ROUTE);
      return;
    }
    navigate(AGENT_ROUTE);
    void submit(submitOptions, sentence);
  }, [navigate, submit, submitOptions]);

  const handleSubmit = useCallback(() => {
    void submit(submitOptions);
  }, [submit, submitOptions]);

  const handleExample = useCallback((sentence: string) => {
    void submit(submitOptions, sentence);
  }, [submit, submitOptions]);

  const retryText = turn?.text;
  const handleRetry = useCallback(() => {
    if (retryText) void submit(submitOptions, retryText);
  }, [retryText, submit, submitOptions]);

  const resultView = useMemo(() => (
    <AgentResultView
      status={status}
      turn={turn}
      onUiAction={handleUiAction}
      onExample={handleExample}
      onRetry={handleRetry}
    />
  ), [handleExample, handleRetry, handleUiAction, status, turn]);

  if (!enabled) return undefined;

  return {
    mode,
    onModeChange: handleModeChange,
    text,
    onTextChange: setText,
    onSubmit: handleSubmit,
    onReset: reset,
    isBusy: status !== 'idle',
    hasTurn: Boolean(turn),
    resultView,
    onAskAgent: handleAskAgent,
  };
}
