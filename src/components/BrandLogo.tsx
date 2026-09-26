import { useTranslation } from 'react-i18next';

const brandLogoSrc = `${import.meta.env.BASE_URL}brand/logo.png`;

interface BrandLogoProps {
  className?: string;
}

export function BrandLogo({ className = 'h-16 w-auto shrink-0 object-contain sm:h-20' }: BrandLogoProps) {
  const { t } = useTranslation();
  return (
    <img
      src={brandLogoSrc}
      alt={t('title')}
      className={className}
      width={280}
      height={80}
      decoding="async"
    />
  );
}
