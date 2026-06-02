import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { getLabAppScopedPath, labAppRoute } from '../utils/appRoutes';

export type AppTab = 'search' | 'logs' | 'cabinet' | 'inventory' | 'admin';

interface UseAppUiStateParams {
  pathname: string;
  activeCabinetId: string | null;
  currentLabId: string | null;
  lastSearchQuery: string;
  navigate: NavigateFunction;
  /** 비로그인 시 검색 탭만 허용, 그 외 탭은 로그인으로 유도 */
  isAuthenticated: boolean;
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
  const appPathname = getLabAppScopedPath(pathname);
  if (appPathname.startsWith('/logs')) return 'logs';
  if (appPathname.startsWith('/cabinet')) return 'cabinet';
  if (appPathname.startsWith('/inventory')) return 'inventory';
  if (appPathname.startsWith('/admin')) return 'admin';
  return 'search';
}

export function useAppUiState({
  pathname,
  activeCabinetId,
  currentLabId,
  lastSearchQuery,
  navigate,
  isAuthenticated,
}: UseAppUiStateParams): UseAppUiStateResult {
  const [isScanning, setIsScanning] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [logRefreshKey, setLogRefreshKey] = useState(0);
  const lastCabinetIdRef = useRef<string | null>(activeCabinetId);
  const previousLabIdRef = useRef<string | null | undefined>(currentLabId);

  const activeTab = useMemo(() => getActiveTab(pathname), [pathname]);

  useEffect(() => {
    if (activeTab === 'cabinet' && activeCabinetId) {
      lastCabinetIdRef.current = activeCabinetId;
    }
  }, [activeCabinetId, activeTab]);

  // 연구실이 실제로 바뀐 경우에만 시약장 컨텍스트를 초기화합니다.
  // 기존에는 /cabinet?id=... 로 이동할 때도 pathname 변화만으로 상세 ID를 지워버렸습니다.
  useEffect(() => {
    if (previousLabIdRef.current === currentLabId) {
      return;
    }

    previousLabIdRef.current = currentLabId;
    lastCabinetIdRef.current = null;

    const appPathname = getLabAppScopedPath(pathname);
    if (appPathname.startsWith('/cabinet')) {
      navigate(labAppRoute('/cabinet'));
    }
  }, [currentLabId, navigate, pathname]);

  const handleTabClick = useCallback((tab: AppTab) => {
    if (!isAuthenticated && tab !== 'search') {
      const returnTo =
        tab === 'logs'
          ? labAppRoute('/logs')
          : tab === 'cabinet'
            ? lastCabinetIdRef.current
              ? labAppRoute(`/cabinet?id=${lastCabinetIdRef.current}`)
              : labAppRoute('/cabinet')
            : tab === 'inventory'
              ? labAppRoute('/inventory')
            : tab === 'admin'
                ? labAppRoute('/admin')
                : labAppRoute();
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    switch (tab) {
      case 'search':
        navigate(lastSearchQuery ? `${labAppRoute()}?q=${encodeURIComponent(lastSearchQuery)}` : labAppRoute());
        break;
      case 'logs':
        navigate(labAppRoute('/logs'));
        break;
      case 'cabinet':
        navigate(lastCabinetIdRef.current ? labAppRoute(`/cabinet?id=${lastCabinetIdRef.current}`) : labAppRoute('/cabinet'));
        break;
      case 'inventory':
        navigate(labAppRoute('/inventory'));
        break;
      case 'admin':
        navigate(labAppRoute('/admin'));
        break;
      default:
        navigate(labAppRoute());
        break;
    }
  }, [isAuthenticated, lastSearchQuery, navigate]);

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
