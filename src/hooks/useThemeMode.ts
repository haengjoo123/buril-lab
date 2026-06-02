import { useCallback, useEffect, useState } from 'react';

const THEME_STORAGE_KEY = 'buril-theme';
const THEME_CHANGE_EVENT = 'buril-theme-change';

type ThemeChangeEvent = CustomEvent<{ isDarkMode: boolean }>;

const getInitialDarkMode = () => {
  if (typeof window === 'undefined') return false;

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === 'dark') return true;
  if (storedTheme === 'light') return false;

  return document.documentElement.classList.contains('dark');
};

export function useThemeMode() {
  const [isDarkMode, setIsDarkModeState] = useState(getInitialDarkMode);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? 'dark' : 'light');
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { isDarkMode } }));
  }, [isDarkMode]);

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      setIsDarkModeState((event as ThemeChangeEvent).detail.isDarkMode);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setIsDarkModeState(event.newValue === 'dark');
    };

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setIsDarkMode = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    setIsDarkModeState((current) => (typeof value === 'function' ? value(current) : value));
  }, []);

  const toggleThemeMode = useCallback(() => {
    setIsDarkModeState((current) => !current);
  }, []);

  return { isDarkMode, setIsDarkMode, toggleThemeMode };
}
