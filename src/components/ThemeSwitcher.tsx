import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { THEMES, type ThemeDefinition, type ThemeMode } from '../themes/registry';
import { useTheme } from '../themes/ThemeProvider';

type FilterMode = 'all' | ThemeMode;

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { themeId, setThemeId } = useTheme();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [query, setQuery] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return THEMES.filter((theme) => {
      if (filter !== 'all' && theme.mode !== filter) return false;
      if (!q) return true;
      return theme.name.toLowerCase().includes(q) || theme.id.includes(q);
    });
  }, [filter, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = filtered.findIndex((item) => item.id === themeId);
    setFocusIndex(idx >= 0 ? idx : 0);
  }, [open, filter, themeId]);

  useEffect(() => {
    setFocusIndex((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const focusThemeAt = (index: number) => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-theme-index="${index}"]`);
    node?.focus();
  };

  const selectTheme = (theme: ThemeDefinition) => {
    setThemeId(theme.id);
    setOpen(false);
  };

  const onDialogKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  const onSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' && filtered.length > 0) {
      event.preventDefault();
      const next = Math.min(focusIndex, filtered.length - 1);
      setFocusIndex(next);
      focusThemeAt(next);
    }
  };

  const onGridKeyDown = (event: KeyboardEvent) => {
    const cols = window.matchMedia('(min-width: 640px)').matches ? 3 : 2;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setFocusIndex((i) => {
        const next = Math.min(filtered.length - 1, i + 1);
        focusThemeAt(next);
        return next;
      });
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setFocusIndex((i) => {
        const next = Math.max(0, i - 1);
        focusThemeAt(next);
        return next;
      });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusIndex((i) => {
        const next = Math.min(filtered.length - 1, i + cols);
        focusThemeAt(next);
        return next;
      });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusIndex((i) => {
        const next = Math.max(0, i - cols);
        focusThemeAt(next);
        return next;
      });
    } else if (event.key === 'Enter' || event.key === ' ') {
      const theme = filtered[focusIndex];
      if (theme) {
        event.preventDefault();
        selectTheme(theme);
      }
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:bg-band hover:text-ink"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? titleId : undefined}
        title={t('themePickerTitle')}
      >
        <Palette className="h-4 w-4" aria-hidden />
        <span className="sr-only">{t('themePickerTitle')}</span>
      </button>

      {open ? (
        <div
          id={titleId}
          role="dialog"
          aria-modal="false"
          aria-label={t('themePickerTitle')}
          className="absolute end-0 top-full z-[60] mt-1 w-[min(100vw-1.5rem,22rem)] rounded-xl border border-line bg-surface p-3 shadow-card"
          onKeyDown={onDialogKeyDown}
        >
          <p className="mb-2 text-sm font-semibold text-ink">{t('themePickerTitle')}</p>
          <div className="mb-2 flex flex-wrap gap-1">
            {(['all', 'light', 'dark'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  filter === item ? 'bg-primary/25 text-ink ring-1 ring-primary/35' : 'text-muted hover:bg-band'
                }`}
              >
                {t(`themeFilter_${item}`)}
              </button>
            ))}
          </div>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={t('themeSearchPlaceholder')}
            className="form-control mb-2 py-2 text-xs"
            aria-label={t('themeSearchPlaceholder')}
          />
          <div
            ref={listRef}
            role="radiogroup"
            aria-label={t('themePickerTitle')}
            onKeyDown={onGridKeyDown}
            className="grid max-h-[min(50vh,20rem)] grid-cols-2 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-3"
          >
            {filtered.map((theme, index) => {
              const selected = theme.id === themeId;
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-theme-index={index}
                  tabIndex={index === focusIndex ? 0 : -1}
                  onClick={() => selectTheme(theme)}
                  onFocus={() => setFocusIndex(index)}
                  className={`rounded-lg border p-2 text-start transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    selected ? 'border-primary ring-1 ring-primary/40' : 'border-line hover:border-primary/30'
                  }`}
                >
                  <span className="mb-1.5 flex h-3 overflow-hidden rounded-sm">
                    <span className="flex-1" style={{ background: theme.colors.hd }} />
                    <span className="flex-1" style={{ background: theme.colors.bg }} />
                    <span className="flex-1" style={{ background: theme.colors.ac }} />
                  </span>
                  <span className="block truncate text-[11px] font-medium leading-tight text-ink">{theme.name}</span>
                </button>
              );
            })}
          </div>
          {filtered.length === 0 ? (
            <p className="mt-2 text-center text-xs text-muted">{t('themeNoResults')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
