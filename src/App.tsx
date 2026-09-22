import { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { AdminView } from './components/admin/AdminView';
import { BookingPage } from './components/booking/BookingPage';
import { useDocumentDirection } from './hooks/useDocumentDirection';

function App() {
  useDocumentDirection();
  const [showAdmin, setShowAdmin] = useState(false);

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
