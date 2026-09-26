import { useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { AdminView } from './components/admin/AdminView';
import { BookingPage } from './components/booking/BookingPage';
import { useDocumentDirection } from './hooks/useDocumentDirection';
import { verifyCustomerRegistration } from './services/customerService';
import { BookingApiError, errorI18nKey } from './utils/errors';

function App() {
  useDocumentDirection();
  const { t } = useTranslation();
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const registerToken = params.get('registerToken');
    if (!registerToken) return;

    const separator = registerToken.indexOf('.');
    if (separator <= 0) return;

    const challengeId = registerToken.slice(0, separator);
    const token = registerToken.slice(separator + 1);
    void verifyCustomerRegistration({ challengeId, token })
      .then(() => toast.success(t('customerRegisterSuccess')))
      .catch((error) => {
        const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
        toast.error(t(errorI18nKey(code)));
      })
      .finally(() => {
        window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      });
  }, [t]);

  if (showAdmin) {
    return <AdminView onLogout={() => setShowAdmin(false)} />;
  }

  return (
    <>
      <Toaster position="top-center" />
      <BookingPage onOpenAdmin={() => setShowAdmin(true)} />
    </>
  );
}

export default App;
