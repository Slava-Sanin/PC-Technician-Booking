import {
  DEFAULT_THEME_ID,
  STORAGE_KEY,
  THEME_BY_ID,
  type ThemeDefinition,
} from './registry';

export function getDefaultThemeId(): string {
  return DEFAULT_THEME_ID;
}

export function readStoredThemeId(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && THEME_BY_ID[value] ? value : null;
  } catch {
    return null;
  }
}

export function resolveInitialThemeId(): string {
  const fromStorage = readStoredThemeId();
  if (fromStorage) return fromStorage;
  if (typeof document !== 'undefined') {
    const fromDom = document.documentElement.getAttribute('data-theme');
    if (fromDom && THEME_BY_ID[fromDom]) return fromDom;
  }
  return getDefaultThemeId();
}

export function applyThemeId(themeId: string): ThemeDefinition | null {
  const theme = THEME_BY_ID[themeId];
  if (!theme) return null;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  if (theme.font === 'mono') {
    root.style.setProperty(
      '--font-body',
      'ui-monospace, "JetBrains Mono", Consolas, monospace',
    );
  } else {
    root.style.removeProperty('--font-body');
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    // ignore
  }
  return theme;
}
