import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_THEME_ID, THEME_BY_ID, type ThemeDefinition } from './registry';
import { applyThemeId, resolveInitialThemeId } from './theme';

type ThemeContextValue = {
  themeId: string;
  theme: ThemeDefinition;
  setThemeId: (id: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState(() => resolveInitialThemeId());

  const setThemeId = useCallback((id: string) => {
    if (!THEME_BY_ID[id]) return;
    applyThemeId(id);
    setThemeIdState(id);
  }, []);

  useEffect(() => {
    applyThemeId(themeId);
  }, [themeId]);

  const value = useMemo(
    () => ({
      themeId,
      theme: THEME_BY_ID[themeId] ?? THEME_BY_ID[DEFAULT_THEME_ID],
      setThemeId,
    }),
    [themeId, setThemeId],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
