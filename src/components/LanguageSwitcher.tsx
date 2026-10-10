import { useTranslation } from 'react-i18next';

const LANGUAGES = ['ru', 'he', 'en'] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage || i18n.language || 'ru').split('-')[0];

  return (
    <div className="flex gap-0.5">
      {LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          onClick={() => i18n.changeLanguage(language)}
          className={`min-w-[1.5rem] rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none transition-colors ${
            current === language
              ? 'bg-primary/30 font-semibold text-ink ring-1 ring-primary/40'
              : 'border border-line bg-surface text-ink hover:bg-canvas'
          }`}
        >
          {language.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
