import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function useDocumentDirection(): void {
  const { i18n } = useTranslation();

  useEffect(() => {
    const lang = (i18n.resolvedLanguage || i18n.language || 'ru').split('-')[0];
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  }, [i18n, i18n.language, i18n.resolvedLanguage]);
}
