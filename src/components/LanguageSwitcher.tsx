import { useTranslation } from 'react-i18next';

const LANGUAGES = ['ru', 'he', 'en'] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage || i18n.language || 'ru').split('-')[0];

  return (
    <div className="flex gap-2">
      {LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          onClick={() => i18n.changeLanguage(language)}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            current === language
              ? 'bg-blue-600 text-white shadow'
              : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
          }`}
        >
          {language.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
