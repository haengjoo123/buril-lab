import { createContext, useContext, useEffect } from 'react';

/**
 * What the workspace is currently showing, so the shell can drop section
 * navigation and duplicate titles while the user has no approved center.
 */
export type SafetyCenterShellMode = 'loading' | 'apply' | 'pending' | 'active';

interface SafetyCenterShellContextValue {
  setMode: (mode: SafetyCenterShellMode) => void;
  onSignOut?: () => void;
}

export const SafetyCenterShellContext = createContext<SafetyCenterShellContextValue | null>(null);

export function getSafetyCenterShellMode(input: {
  hasLoadedCenters: boolean;
  centerStatus: string | null | undefined;
}): SafetyCenterShellMode {
  if (!input.hasLoadedCenters) return 'loading';
  if (!input.centerStatus) return 'apply';
  return input.centerStatus === 'approved' ? 'active' : 'pending';
}

export function useReportSafetyCenterShellMode(mode: SafetyCenterShellMode) {
  const setMode = useContext(SafetyCenterShellContext)?.setMode;
  useEffect(() => {
    setMode?.(mode);
  }, [mode, setMode]);
}

export function useSafetyCenterSignOut() {
  return useContext(SafetyCenterShellContext)?.onSignOut;
}
