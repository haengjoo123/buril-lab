import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';

export type AppTab = 'search' | 'logs' | 'cabinet' | 'inventory' | 'admin';

interface UseAppUiStateParams {
  pathname: string;
  activeCabinetId: string | null;
  currentLabId: string | null;
  lastSearchQuery: string;
  navigate: NavigateFunction;
}

interface UseAppUiStateResult {
  activeTab: AppTab;
  isScanning: boolean;
  setIsScanning: (value: boolean) => void;
  isCartOpen: boolean;
  setIsCartOpen: (value: boolean) => void;
  logRefreshKey: number;
  incrementLogRefreshKey: () => void;
  handleTabClick: (tab: AppTab) => void;
}

function getActiveTab(pathname: string): AppTab {
  if (pathname.startsWith('/logs')) return 'logs';
  if (pathname.startsWith('/cabinet')) return 'cabinet';
  if (pathname.startsWith('/inventory')) return 'inventory';
  if (pathname.startsWith('/admin')) return 'admin';
  return 'search';
}

export function useAppUiState({
  pathname,
  activeCabinetId,
  currentLabId,
  lastSearchQuery,
  navigate,
}: UseAppUiStateParams): UseAppUiStateResult {
  const [isScanning, setIsScanning] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [logRefreshKey, setLogRefreshKey] = useState(0);
  const [lastCabinetId, setLastCabinetId] = useState<string | null>(null);
  const previousLabIdRef = useRef<string | null | undefined>(currentLabId);

  const activeTab = useMemo(() => getActiveTab(pathname), [pathname]);

  // 시약장 상세 진입 상태를 기억해 탭 재진입 시 같은 캐비닛으로 복귀한다.
  useEffect(() => {
    if (activeTab === 'cabinet') {
      setLastCabinetId(activeCabinetId);
    }
  }, [activeTab, activeCabinetId]);

  // 연구실이 실제로 바뀐 경우에만 시약장 컨텍스트를 초기화합니다.
  // 기존에는 /cabinet?id=... 로 이동할 때도 pathname 변화만으로 상세 ID를 지워버렸습니다.
  useEffect(() => {
    if (previousLabIdRef.current === currentLabId) {
      return;
    }

    previousLabIdRef.current = currentLabId;
    setLastCabinetId(null);

    if (pathname.startsWith('/cabinet')) {
      navigate('/cabinet');
    }
  }, [currentLabId, navigate, pathname]);

  const handleTabClick = useCallback((tab: AppTab) => {
    switch (tab) {
      case 'search':
        navigate(lastSearchQuery ? `/?q=${encodeURIComponent(lastSearchQuery)}` : '/');
        break;
      case 'logs':
        navigate('/logs');
        break;
      case 'cabinet':
        navigate(lastCabinetId ? `/cabinet?id=${lastCabinetId}` : '/cabinet');
        break;
      case 'inventory':
        navigate('/inventory');
        break;
      case 'admin':
        navigate('/admin');
        break;
      default:
        navigate('/');
        break;
    }
  }, [lastSearchQuery, lastCabinetId, navigate]);

  const incrementLogRefreshKey = useCallback(() => {
    setLogRefreshKey((prev) => prev + 1);
  }, []);

  return {
    activeTab,
    isScanning,
    setIsScanning,
    isCartOpen,
    setIsCartOpen,
    logRefreshKey,
    incrementLogRefreshKey,
    handleTabClick,
  };
}
