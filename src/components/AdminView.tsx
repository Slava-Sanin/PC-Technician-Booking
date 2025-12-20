import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle, LogIn, Trash2, ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown, Settings, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toast, Toaster } from 'react-hot-toast';

type Booking = {
  id: string;
  booking_number: string;
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  city: string | null;
  operating_system: string;
  comments: string;
  appointment_date: string;
  created_at: string;
  updated_at: string;
  completed: boolean;
  technician_notes: string;
};

interface AdminViewProps {
  onLogout: () => void;
}

export function AdminView({ onLogout }: AdminViewProps) {
  const { t, i18n } = useTranslation();
  
  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const getCurrentLanguage = () => {
    return i18n.language?.split('-')[0] || i18n.language || 'ru';
  };
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [editedFields, setEditedFields] = useState<Record<string, Partial<Booking>>>({});
  const [sortColumn, setSortColumn] = useState<keyof Booking | null>('appointment_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showSettings, setShowSettings] = useState(false);
  
  // Settings state
  const [settings, setSettings] = useState({
    firstDayOfWeek: 1, // 0 = Sunday, 1 = Monday, etc.
    disabledWeekdays: [] as number[], // 0 = Sunday, 6 = Saturday
    disabledDates: [] as string[], // Array of date strings in YYYY-MM-DD format
    minIntervalHours: 3, // Minimum interval between bookings in hours
    workStartTime: '09:00', // Work start time (HH:mm format)
    workEndTime: '20:00', // Work end time (HH:mm format)
    maxBookingsPerDay: null as number | null, // Maximum bookings per day (null = no limit)
    sendSMS: true // Send SMS when booking is created
  });

  useEffect(() => {
    checkAuth();
    loadSettings();
  }, []);

  const loadSettings = () => {
    const savedSettings = localStorage.getItem('bookingSettings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        // Merge with defaults to ensure all new fields are present
        setSettings({
          firstDayOfWeek: parsed.firstDayOfWeek ?? 1,
          disabledWeekdays: parsed.disabledWeekdays ?? [],
          disabledDates: parsed.disabledDates ?? [],
          minIntervalHours: parsed.minIntervalHours ?? 3,
          workStartTime: parsed.workStartTime ?? '09:00',
          workEndTime: parsed.workEndTime ?? '20:00',
          maxBookingsPerDay: parsed.maxBookingsPerDay ?? null,
          sendSMS: parsed.sendSMS ?? true
        });
      } catch (e) {
        console.error('Error loading settings:', e);
      }
    }
  };

  const saveSettings = (newSettings: typeof settings) => {
    setSettings(newSettings);
    localStorage.setItem('bookingSettings', JSON.stringify(newSettings));
    toast.success(t('settingsSaved') || 'Settings saved');
  };

  // Helper functions for date formatting
  const formatDateToDDMMYYYY = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
      // Parse YYYY-MM-DD format directly to avoid timezone issues
      const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const [, year, month, day] = match;
        return `${day}/${month}/${year}`;
      }
      // Fallback to Date parsing if format doesn't match
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return dateStr;
    }
  };

  // Helper function to format date to YYYY-MM-DD in local time
  const formatDateToYYYYMMDD = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const parseDDMMYYYYToYYYYMMDD = (dateStr: string): string => {
    if (!dateStr) return '';
    // Try to parse dd/mm/yyyy format
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      const dayPadded = day.padStart(2, '0');
      const monthPadded = month.padStart(2, '0');
      return `${year}-${monthPadded}-${dayPadded}`;
    }
    // If format doesn't match, try to parse as ISO string or other format
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        // Use local time instead of UTC
        return formatDateToYYYYMMDD(date);
      }
    } catch {
      // Ignore
    }
    return dateStr;
  };

  const checkAuth = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      
      setIsAuthenticated(!!session);
      if (session) {
        fetchBookings();
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error('Auth error:', error);
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        if (error.message === 'Invalid login credentials') {
          toast.error(t('invalidCredentials'));
        } else {
          toast.error(t('loginError'));
        }
        return;
      }

      setIsAuthenticated(true);
      fetchBookings();
    } catch (error) {
      console.error('Login error:', error);
      toast.error(t('loginError'));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setIsAuthenticated(false);
      setBookings([]);
      onLogout();
    } catch (error) {
      console.error('Logout error:', error);
      toast.error(t('logoutError'));
    }
  };

  const fetchBookings = async () => {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .is('deleted_at', null);

      if (error) throw error;
      setBookings(data || []);
      
      // Initialize edited fields with current values
      const initialFields: Record<string, Partial<Booking>> = {};
      data?.forEach(booking => {
        initialFields[booking.id] = {};
      });
      setEditedFields(initialFields);
    } catch (error) {
      console.error('Error fetching bookings:', error);
      toast.error(t('fetchError'));
    } finally {
      setLoading(false);
    }
  };

  const updateBookingStatus = async (id: string, completed: boolean) => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ completed })
        .eq('id', id);

      if (error) throw error;
      fetchBookings();
      toast.success(t('statusUpdated'));
    } catch (error) {
      console.error('Error updating booking:', error);
      toast.error(t('updateError'));
    }
  };


  const handleFieldChange = (id: string, field: keyof Booking, value: any) => {
    setEditedFields(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value
      }
    }));
  };

  const getFieldUpdateMessage = (field: keyof Booking): string => {
    const fieldMessages: Record<string, string> = {
      'appointment_date': t('appointmentDateUpdated'),
      'first_name': t('firstNameUpdated'),
      'last_name': t('lastNameUpdated'),
      'phone': t('phoneUpdated'),
      'city': t('cityUpdated'),
      'address': t('addressUpdated'),
      'operating_system': t('operatingSystemUpdated'),
      'comments': t('commentsUpdated'),
      'technician_notes': t('notesUpdated'),
    };
    return fieldMessages[field] || t('fieldUpdated');
  };

  const saveField = async (id: string, field: keyof Booking, directValue?: any) => {
    try {
      // Use direct value if provided, otherwise get from editedFields
      const value = directValue !== undefined ? directValue : editedFields[id]?.[field];
      if (value === undefined) return;

      const updateData: any = { [field]: value };
      
      // Handle date field conversion
      if (field === 'appointment_date' && typeof value === 'string') {
        updateData.appointment_date = new Date(value).toISOString();
      }

      // Handle city field - allow empty string to be saved as null
      if (field === 'city' && value === '') {
        updateData.city = null;
      }

      const { error } = await supabase
        .from('bookings')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;
      
      // Clear edited field
      setEditedFields(prev => {
        const updated = { ...prev };
        if (updated[id]) {
          const { [field]: _, ...rest } = updated[id];
          updated[id] = rest;
        }
        return updated;
      });
      
      fetchBookings();
      toast.success(getFieldUpdateMessage(field));
    } catch (error) {
      console.error(`Error updating ${field}:`, error);
      toast.error(t('updateError'));
    }
  };

  const getFieldValue = (booking: Booking, field: keyof Booking) => {
    if (editedFields[booking.id]?.[field] !== undefined) {
      return editedFields[booking.id][field];
    }
    return booking[field];
  };

  const deleteBooking = async (id: string) => {
    if (window.confirm(t('confirmDelete'))) {
      try {
        const { error } = await supabase
          .from('bookings')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id);

        if (error) throw error;
        fetchBookings();
        toast.success(t('bookingDeleted'));
      } catch (error) {
        console.error('Error deleting booking:', error);
        toast.error(t('deleteError'));
      }
    }
  };

  const handleSort = (column: keyof Booking) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const sortedBookings = [...bookings].sort((a, b) => {
    if (!sortColumn) return 0;

    let aValue: any = a[sortColumn];
    let bValue: any = b[sortColumn];

    // Handle different data types
    if (sortColumn === 'appointment_date' || sortColumn === 'created_at' || sortColumn === 'updated_at') {
      aValue = new Date(aValue).getTime();
      bValue = new Date(bValue).getTime();
    } else if (sortColumn === 'completed') {
      aValue = aValue ? 1 : 0;
      bValue = bValue ? 1 : 0;
    } else if (sortColumn === 'first_name') {
      aValue = a.first_name.toLowerCase();
      bValue = b.first_name.toLowerCase();
    } else if (sortColumn === 'last_name') {
      aValue = a.last_name.toLowerCase();
      bValue = b.last_name.toLowerCase();
    } else if (sortColumn === 'city') {
      // Handle null values for city - null values go to the end
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    } else if (sortColumn === 'address') {
      aValue = (aValue || '').toLowerCase();
      bValue = (bValue || '').toLowerCase();
    } else if (sortColumn === 'phone') {
      aValue = (aValue || '').toLowerCase();
      bValue = (bValue || '').toLowerCase();
    } else if (typeof aValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <Toaster position="top-right" />
        <div className="fixed top-4 right-4 flex gap-2">
          <button 
            onClick={() => changeLanguage('ru')} 
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              getCurrentLanguage() === 'ru' 
                ? 'bg-blue-600 text-white shadow' 
                : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
            }`}
          >
            RU
          </button>
          <button 
            onClick={() => changeLanguage('he')} 
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              getCurrentLanguage() === 'he' 
                ? 'bg-blue-600 text-white shadow' 
                : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
            }`}
          >
            HE
          </button>
          <button 
            onClick={() => changeLanguage('en')} 
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              getCurrentLanguage() === 'en' 
                ? 'bg-blue-600 text-white shadow' 
                : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
            }`}
          >
            EN
          </button>
        </div>
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              {t('loginTitle')}
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              {t('loginSubtitle')}
            </p>
          </div>
          <form className="mt-8 space-y-6" onSubmit={handleLogin}>
            <div className="rounded-md shadow-sm -space-y-px">
              <div>
                <label htmlFor="email-address" className="sr-only">
                  {t('email')}
                </label>
                <input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder={t('email')}
                  disabled={loginLoading}
                />
              </div>
              <div>
                <label htmlFor="password" className="sr-only">
                  {t('password')}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder={t('password')}
                  disabled={loginLoading}
                />
              </div>
            </div>

            <div className="flex flex-col space-y-3">
              <button
                type="submit"
                disabled={loginLoading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="absolute left-0 inset-y-0 flex items-center pl-3">
                  <LogIn className="h-5 w-5 text-blue-500 group-hover:text-blue-400" />
                </span>
                {loginLoading ? t('loggingIn') : t('login')}
              </button>
              
              <button
                type="button"
                onClick={onLogout}
                className="group relative w-full flex justify-center py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <span className="absolute left-0 inset-y-0 flex items-center pl-3">
                  <ArrowLeft className="h-5 w-5 text-gray-500 group-hover:text-gray-400" />
                </span>
                {t('backToBooking')}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" />
      <div className="sticky top-0 z-10 bg-gray-50">
        <div className="w-full px-4 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold flex-1 text-center">{t('adminTitle')}</h2>
            <div className="flex items-center gap-3 flex-2 justify-end">
              <button
                onClick={() => setShowSettings(true)}
                className="px-3 py-1 rounded text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 transition-colors flex items-center gap-2"
                title={t('settings') || 'Settings'}
              >
                <Settings className="w-4 h-4" />
                {t('settings') || 'Settings'}
              </button>
              <div className="flex gap-2">
                <button 
                  onClick={() => changeLanguage('ru')} 
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    getCurrentLanguage() === 'ru' 
                      ? 'bg-blue-600 text-white shadow' 
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  RU
                </button>
                <button 
                  onClick={() => changeLanguage('he')} 
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    getCurrentLanguage() === 'he' 
                      ? 'bg-blue-600 text-white shadow' 
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  HE
                </button>
                <button 
                  onClick={() => changeLanguage('en')} 
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    getCurrentLanguage() === 'en' 
                      ? 'bg-blue-600 text-white shadow' 
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  EN
                </button>
              </div>
              <button
                onClick={handleLogout}
                className="ml-4 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                {t('logout')}
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center relative">
              <h3 className="text-xl font-bold flex-1 text-center">{t('settings')?.toUpperCase() || 'SETTINGS'}</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-gray-500 hover:text-gray-700 absolute right-6"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* First Day of Week */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('firstDayOfWeek') || 'First day of week'}
                </label>
                <select
                  value={settings.firstDayOfWeek}
                  onChange={(e) => saveSettings({ ...settings, firstDayOfWeek: parseInt(e.target.value) })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="0">{t('sunday') || 'Sunday'}</option>
                  <option value="1">{t('monday') || 'Monday'}</option>
                </select>
              </div>

              {/* Disabled Weekdays */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('disabledWeekdays') || 'Disabled week days'}
                </label>
                <div className="space-y-2">
                  {[
                    { value: 0, label: t('sunday') || 'Sunday' },
                    { value: 1, label: t('monday') || 'Monday' },
                    { value: 2, label: t('tuesday') || 'Tuesday' },
                    { value: 3, label: t('wednesday') || 'Wednesday' },
                    { value: 4, label: t('thursday') || 'Thursday' },
                    { value: 5, label: t('friday') || 'Friday' },
                    { value: 6, label: t('saturday') || 'Saturday' }
                  ].map(day => (
                    <label key={day.value} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={settings.disabledWeekdays.includes(day.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            saveSettings({
                              ...settings,
                              disabledWeekdays: [...settings.disabledWeekdays, day.value]
                            });
                          } else {
                            saveSettings({
                              ...settings,
                              disabledWeekdays: settings.disabledWeekdays.filter(d => d !== day.value)
                            });
                          }
                        }}
                        className="mr-2"
                      />
                      <span>{day.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Disabled Dates */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('disabledDates') || 'Disabled dates'}
                </label>
                <div className="space-y-2">
                  {settings.disabledDates.map((date, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={formatDateToDDMMYYYY(date)}
                        onChange={(e) => {
                          const inputValue = e.target.value;
                          const newDates = [...settings.disabledDates];
                          newDates[index] = parseDDMMYYYYToYYYYMMDD(inputValue);
                          saveSettings({ ...settings, disabledDates: newDates });
                        }}
                        onBlur={(e) => {
                          const inputValue = e.target.value;
                          const parsedDate = parseDDMMYYYYToYYYYMMDD(inputValue);
                          // Validate the date
                          const match = inputValue.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                          if (match) {
                            const [, day, month, year] = match;
                            const dayNum = parseInt(day, 10);
                            const monthNum = parseInt(month, 10);
                            const yearNum = parseInt(year, 10);
                            
                            // Validate ranges
                            if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31 || yearNum < 1900 || yearNum > 2100) {
                              // Invalid date, revert to original
                              const newDates = [...settings.disabledDates];
                              newDates[index] = date;
                              saveSettings({ ...settings, disabledDates: newDates });
                              return;
                            }
                            
                            // Try to create date to validate
                            const testDate = new Date(parsedDate);
                            if (isNaN(testDate.getTime()) || 
                                testDate.getDate() !== dayNum || 
                                testDate.getMonth() + 1 !== monthNum) {
                              // Invalid date, revert to original
                              const newDates = [...settings.disabledDates];
                              newDates[index] = date;
                              saveSettings({ ...settings, disabledDates: newDates });
                              return;
                            }
                            
                            // Valid date, save it
                            const newDates = [...settings.disabledDates];
                            newDates[index] = parsedDate;
                            saveSettings({ ...settings, disabledDates: newDates });
                          } else if (inputValue === '') {
                            // Empty value, remove the date
                            const newDates = settings.disabledDates.filter((_, i) => i !== index);
                            saveSettings({ ...settings, disabledDates: newDates });
                          } else {
                            // Invalid format, revert to original
                            const newDates = [...settings.disabledDates];
                            newDates[index] = date;
                            saveSettings({ ...settings, disabledDates: newDates });
                          }
                        }}
                        placeholder="dd/mm/yyyy"
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => {
                          const newDates = settings.disabledDates.filter((_, i) => i !== index);
                          saveSettings({ ...settings, disabledDates: newDates });
                        }}
                        className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                      >
                        {t('remove') || 'Remove'}
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const today = formatDateToYYYYMMDD(new Date());
                      saveSettings({
                        ...settings,
                        disabledDates: [...settings.disabledDates, today]
                      });
                    }}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    {t('addDate') || 'Add Date'}
                  </button>
                </div>
              </div>

              {/* Minimum Interval Between Bookings */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('minIntervalHours')}
                </label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={settings.minIntervalHours}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (!isNaN(value) && value >= 1 && value <= 24) {
                      saveSettings({ ...settings, minIntervalHours: value });
                    }
                  }}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Work Hours */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('workHours')}
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('workStartTime')}
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={settings.workStartTime.split(':')[0]}
                        onChange={(e) => {
                          const newHour = e.target.value;
                          const minutes = settings.workStartTime.split(':')[1] || '00';
                          const newStartTime = `${newHour}:${minutes}`;
                          // Validate: start time must be before end time
                          if (newStartTime >= settings.workEndTime) {
                            toast.error(t('workEndTimeError'));
                            return;
                          }
                          saveSettings({ ...settings, workStartTime: newStartTime });
                        }}
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      >
                        {Array.from({ length: 24 }, (_, i) => {
                          const hour = String(i + 1).padStart(2, '0');
                          return (
                            <option key={hour} value={hour}>
                              {hour}
                            </option>
                          );
                        })}
                      </select>
                      <span className="flex items-center text-gray-500">:</span>
                      <select
                        value={settings.workStartTime.split(':')[1] || '00'}
                        onChange={(e) => {
                          const newMinutes = e.target.value;
                          const hours = settings.workStartTime.split(':')[0];
                          const newStartTime = `${hours}:${newMinutes}`;
                          // Validate: start time must be before end time
                          if (newStartTime >= settings.workEndTime) {
                            toast.error(t('workEndTimeError'));
                            return;
                          }
                          saveSettings({ ...settings, workStartTime: newStartTime });
                        }}
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      >
                        {Array.from({ length: 60 }, (_, i) => {
                          const minute = String(i).padStart(2, '0');
                          return (
                            <option key={minute} value={minute}>
                              {minute}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">
                      {t('workEndTime')}
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={settings.workEndTime.split(':')[0]}
                        onChange={(e) => {
                          const newHour = e.target.value;
                          const minutes = settings.workEndTime.split(':')[1] || '00';
                          const newEndTime = `${newHour}:${minutes}`;
                          // Validate: end time must be after start time
                          if (newEndTime <= settings.workStartTime) {
                            toast.error(t('workEndTimeError'));
                            return;
                          }
                          saveSettings({ ...settings, workEndTime: newEndTime });
                        }}
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      >
                        {Array.from({ length: 24 }, (_, i) => {
                          const hour = String(i + 1).padStart(2, '0');
                          return (
                            <option key={hour} value={hour}>
                              {hour}
                            </option>
                          );
                        })}
                      </select>
                      <span className="flex items-center text-gray-500">:</span>
                      <select
                        value={settings.workEndTime.split(':')[1] || '00'}
                        onChange={(e) => {
                          const newMinutes = e.target.value;
                          const hours = settings.workEndTime.split(':')[0];
                          const newEndTime = `${hours}:${newMinutes}`;
                          // Validate: end time must be after start time
                          if (newEndTime <= settings.workStartTime) {
                            toast.error(t('workEndTimeError'));
                            return;
                          }
                          saveSettings({ ...settings, workEndTime: newEndTime });
                        }}
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      >
                        {Array.from({ length: 60 }, (_, i) => {
                          const minute = String(i).padStart(2, '0');
                          return (
                            <option key={minute} value={minute}>
                              {minute}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Maximum Bookings Per Day */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('maxBookingsPerDay')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.maxBookingsPerDay !== null}
                    onChange={(e) => {
                      if (e.target.checked) {
                        saveSettings({ ...settings, maxBookingsPerDay: 10 });
                      } else {
                        saveSettings({ ...settings, maxBookingsPerDay: null });
                      }
                    }}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-600">
                    {t('enableLimit')}
                  </span>
                </div>
                {settings.maxBookingsPerDay !== null && (
                  <input
                    type="number"
                    min="1"
                    value={settings.maxBookingsPerDay}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      if (!isNaN(value) && value >= 1) {
                        saveSettings({ ...settings, maxBookingsPerDay: value });
                      }
                    }}
                    className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                )}
              </div>

              {/* Send SMS */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('sendSMS')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.sendSMS}
                    onChange={(e) => {
                      saveSettings({ ...settings, sendSMS: e.target.checked });
                    }}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-600">
                    {t('sendSMSDescription')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="w-full px-1 pb-8">
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="border-t-2 border-gray-300 mb-4"></div>
          <div className="overflow-x-auto w-full">
            <div className="w-full align-middle">
              <div className="overflow-hidden">
                <table className="w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th 
                        scope="col" 
                        className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10"
                      >
                        #
                      </th>
                      <th 
                        scope="col" 
                        className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => handleSort('booking_number')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {t('bookingNumber')}
                          {sortColumn === 'booking_number' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th 
                        scope="col" 
                        className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => handleSort('completed')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {t('status')}
                          {sortColumn === 'completed' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th 
                        scope="col" 
                        className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => handleSort('appointment_date')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {t('appointmentDate')}
                          {sortColumn === 'appointment_date' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th 
                        scope="col" 
                        className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => handleSort('first_name')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {t('firstName')}
                          {sortColumn === 'first_name' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th 
                        scope="col" 
                        className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => handleSort('last_name')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {t('lastName')}
                          {sortColumn === 'last_name' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th 
                        scope="col" 
                        className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 w-32 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => handleSort('phone')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {t('phone')}
                          {sortColumn === 'phone' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th 
                        scope="col" 
                        className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => handleSort('city')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {t('city')}
                          {sortColumn === 'city' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th 
                        scope="col" 
                        className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => handleSort('address')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {t('address')}
                          {sortColumn === 'address' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th 
                        scope="col" 
                        className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => handleSort('operating_system')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {t('operatingSystem')}
                          {sortColumn === 'operating_system' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th scope="col" className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">
                        {t('comments')}
                      </th>
                      <th scope="col" className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">
                        {t('technicianNotes')}
                      </th>
                      <th scope="col" className="px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider sticky top-0 bg-gray-50 z-10">
                        {t('actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sortedBookings.map((booking, index) => (
                      <tr key={booking.id} className="hover:bg-gray-50">
                        <td className="px-1 py-1 text-sm text-center text-gray-800 font-semibold">
                          {index + 1}
                        </td>
                        <td className="px-1 py-1 text-sm text-gray-800 font-medium">
                          {booking.booking_number}
                        </td>
                        <td className="px-1 py-1 text-center">
                          <button
                            onClick={() => updateBookingStatus(booking.id, !booking.completed)}
                            className="inline-flex items-center justify-center"
                          >
                            {booking.completed ? (
                              <CheckCircle2 className="w-5 h-5 text-green-500" />
                            ) : (
                              <XCircle className="w-5 h-5 text-red-500" />
                            )}
                          </button>
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="text"
                            value={(() => {
                              const value = getFieldValue(booking, 'appointment_date');
                              if (!value) return '';
                              try {
                                const date = new Date(value as string);
                                if (isNaN(date.getTime())) return '';
                                const day = String(date.getDate()).padStart(2, '0');
                                const month = String(date.getMonth() + 1).padStart(2, '0');
                                const year = date.getFullYear();
                                const hours = String(date.getHours()).padStart(2, '0');
                                const minutes = String(date.getMinutes()).padStart(2, '0');
                                return `${day}/${month}/${year} ${hours}:${minutes}`;
                              } catch {
                                return '';
                              }
                            })()}
                            onChange={(e) => {
                              const inputValue = e.target.value;
                              // Try to parse dd/mm/yyyy HH:mm format
                              const match = inputValue.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})/);
                              if (match) {
                                const [, day, month, year, hours, minutes] = match;
                                const dayPadded = day.padStart(2, '0');
                                const monthPadded = month.padStart(2, '0');
                                const hoursPadded = hours.padStart(2, '0');
                                const minutesPadded = minutes.padStart(2, '0');
                                const dateStr = `${year}-${monthPadded}-${dayPadded}T${hoursPadded}:${minutesPadded}`;
                                handleFieldChange(booking.id, 'appointment_date', dateStr);
                              } else {
                                // If format doesn't match, try to parse as ISO string
                                const parsedDate = new Date(inputValue);
                                if (!isNaN(parsedDate.getTime())) {
                                  handleFieldChange(booking.id, 'appointment_date', parsedDate.toISOString());
                                } else {
                                  handleFieldChange(booking.id, 'appointment_date', inputValue);
                                }
                              }
                            }}
                            onBlur={(e) => {
                              const inputValue = e.target.value;
                              // Validate the date format
                              const match = inputValue.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})/);
                              if (match) {
                                const [, day, month, year, hours, minutes] = match;
                                const dayNum = parseInt(day, 10);
                                const monthNum = parseInt(month, 10);
                                const hoursNum = parseInt(hours, 10);
                                const minutesNum = parseInt(minutes, 10);
                                
                                // Validate ranges
                                if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31 || 
                                    hoursNum < 0 || hoursNum > 23 || minutesNum < 0 || minutesNum > 59) {
                                  // Invalid date, revert to original
                                  setEditedFields(prev => {
                                    const updated = { ...prev };
                                    if (updated[booking.id]) {
                                      const { appointment_date: _, ...rest } = updated[booking.id];
                                      updated[booking.id] = rest;
                                    }
                                    return updated;
                                  });
                                  return;
                                }
                                
                                // Try to create date to validate
                                const dayPadded = day.padStart(2, '0');
                                const monthPadded = month.padStart(2, '0');
                                const hoursPadded = hours.padStart(2, '0');
                                const minutesPadded = minutes.padStart(2, '0');
                                const dateStr = `${year}-${monthPadded}-${dayPadded}T${hoursPadded}:${minutesPadded}`;
                                const testDate = new Date(dateStr);
                                
                                if (isNaN(testDate.getTime()) || 
                                    testDate.getDate() !== dayNum || 
                                    testDate.getMonth() + 1 !== monthNum) {
                                  // Invalid date, revert to original
                                  setEditedFields(prev => {
                                    const updated = { ...prev };
                                    if (updated[booking.id]) {
                                      const { appointment_date: _, ...rest } = updated[booking.id];
                                      updated[booking.id] = rest;
                                    }
                                    return updated;
                                  });
                                  return;
                                }
                                
                                // Valid date, save it
                                saveField(booking.id, 'appointment_date');
                              } else if (inputValue === '') {
                                // Empty value, revert to original
                                setEditedFields(prev => {
                                  const updated = { ...prev };
                                  if (updated[booking.id]) {
                                    const { appointment_date: _, ...rest } = updated[booking.id];
                                    updated[booking.id] = rest;
                                  }
                                  return updated;
                                });
                              } else {
                                // Try to parse as ISO string
                                const parsedDate = new Date(inputValue);
                                if (isNaN(parsedDate.getTime())) {
                                  // Invalid date, revert to original
                                  setEditedFields(prev => {
                                    const updated = { ...prev };
                                    if (updated[booking.id]) {
                                      const { appointment_date: _, ...rest } = updated[booking.id];
                                      updated[booking.id] = rest;
                                    }
                                    return updated;
                                  });
                                } else {
                                  // Valid date, save it
                                  saveField(booking.id, 'appointment_date');
                                }
                              }
                            }}
                            placeholder="dd/mm/yyyy HH:mm"
                            className="text-sm font-medium border rounded px-1 py-1 w-full text-gray-800"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="text"
                            value={getFieldValue(booking, 'first_name') as string || ''}
                            onChange={(e) => handleFieldChange(booking.id, 'first_name', e.target.value)}
                            onBlur={() => saveField(booking.id, 'first_name')}
                            className="text-sm font-medium border rounded px-1 py-1 w-full text-gray-800"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="text"
                            value={getFieldValue(booking, 'last_name') as string || ''}
                            onChange={(e) => handleFieldChange(booking.id, 'last_name', e.target.value)}
                            onBlur={() => saveField(booking.id, 'last_name')}
                            className="text-sm font-medium border rounded px-1 py-1 w-full text-gray-800"
                          />
                        </td>
                        <td className="px-1 py-1 whitespace-nowrap w-32">
                          <input
                            type="tel"
                            value={getFieldValue(booking, 'phone') as string || ''}
                            onChange={(e) => handleFieldChange(booking.id, 'phone', e.target.value)}
                            onBlur={() => saveField(booking.id, 'phone')}
                            className="text-sm font-medium border rounded px-1 py-1 w-full text-gray-800"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="text"
                            value={getFieldValue(booking, 'city') as string || ''}
                            onChange={(e) => handleFieldChange(booking.id, 'city', e.target.value)}
                            onBlur={() => saveField(booking.id, 'city')}
                            className="text-sm font-medium border rounded px-1 py-1 w-full text-gray-800"
                            placeholder="-"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="text"
                            value={getFieldValue(booking, 'address') as string || ''}
                            onChange={(e) => handleFieldChange(booking.id, 'address', e.target.value)}
                            onBlur={() => saveField(booking.id, 'address')}
                            className="text-sm font-medium border rounded px-1 py-1 w-full text-gray-800"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <select
                            value={getFieldValue(booking, 'operating_system') as string || ''}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              handleFieldChange(booking.id, 'operating_system', newValue);
                              saveField(booking.id, 'operating_system', newValue);
                            }}
                            className="text-sm font-medium border rounded px-1 py-1 w-full text-gray-800"
                          >
                            <option value="windows">{t('windows')}</option>
                            <option value="linux">{t('linux')}</option>
                            <option value="macos">{t('macos')}</option>
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <textarea
                            value={getFieldValue(booking, 'comments') as string || ''}
                            onChange={(e) => handleFieldChange(booking.id, 'comments', e.target.value)}
                            onBlur={() => saveField(booking.id, 'comments')}
                            className="text-sm font-medium border rounded px-1 py-1 w-full text-gray-800"
                            rows={2}
                          />
                        </td>
                        <td className="px-1 py-1">
                          <textarea
                            value={getFieldValue(booking, 'technician_notes') as string || ''}
                            onChange={(e) => handleFieldChange(booking.id, 'technician_notes', e.target.value)}
                            onBlur={() => saveField(booking.id, 'technician_notes')}
                            className="w-full px-1 py-1 border rounded text-sm font-medium text-gray-800"
                            placeholder={t('addNote')}
                            rows={2}
                          />
                        </td>
                        <td className="px-1 py-1 text-center">
                          <button
                            onClick={() => deleteBooking(booking.id)}
                            className="inline-flex items-center justify-center px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                            title={t('delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}