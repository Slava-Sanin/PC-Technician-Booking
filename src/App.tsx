import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Calendar from 'react-calendar';
import { toast, Toaster } from 'react-hot-toast';
import { Globe, Clock, WrenchIcon } from 'lucide-react';
import { supabase } from './lib/supabase';
import { sendSMS } from './lib/twilioSender';
import { AdminView } from './components/AdminView';
import 'react-calendar/dist/Calendar.css';

type BookingFormData = {
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  city: string;
  operatingSystem: string;
  comments: string;
  appointmentDate: Date | null;
  appointmentTime: string;
};

const OPERATING_SYSTEMS = ['windows', 'linux', 'macos'];

// Generate time slots based on work hours
const generateTimeSlots = (startTime: string, endTime: string): string[] => {
  const slots: string[] = [];
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  
  for (let minutes = startMinutes; minutes <= endMinutes; minutes += 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    slots.push(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);
  }
  
  return slots;
};

function App() {
  const { t, i18n } = useTranslation();
  const [showAdmin, setShowAdmin] = useState(false);
  const [formData, setFormData] = useState<BookingFormData>({
    firstName: '',
    lastName: '',
    phone: '',
    address: '',
    city: '',
    operatingSystem: '',
    comments: '',
    appointmentDate: null,
    appointmentTime: ''
  });
  const [bookedSlots, setBookedSlots] = useState<Date[]>([]);
  const [availableTimeSlots, setAvailableTimeSlots] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [settings, setSettings] = useState({
    firstDayOfWeek: 1,
    disabledWeekdays: [] as number[],
    disabledDates: [] as string[],
    minIntervalHours: 3, // Minimum interval between bookings in hours
    workStartTime: '09:00', // Work start time (HH:mm format)
    workEndTime: '20:00', // Work end time (HH:mm format)
    maxBookingsPerDay: null as number | null, // Maximum bookings per day (null = no limit)
    sendSMS: true // Send SMS when booking is created
  });

  const getCalendarLocale = () => {
    const lang = i18n.language?.split('-')[0] || i18n.language || 'ru';
    // Map language codes to calendar locales
    const localeMap: Record<string, string> = {
      'ru': 'ru',
      'en': 'en',
      'he': 'he'
    };
    return localeMap[lang] || 'en';
  };

  useEffect(() => {
    fetchBookedSlots();
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

  // Listen for settings changes
  useEffect(() => {
    const handleStorageChange = () => {
      loadSettings();
    };
    window.addEventListener('storage', handleStorageChange);
    // Also check periodically for changes (in case settings changed in same window)
    const interval = setInterval(loadSettings, 500);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (formData.appointmentDate) {
      updateAvailableTimeSlots(formData.appointmentDate);
    }
  }, [formData.appointmentDate, bookedSlots, settings]);

  // Refresh booked slots when returning from admin view
  useEffect(() => {
    if (!showAdmin) {
      fetchBookedSlots();
    }
  }, [showAdmin]);

  const fetchBookedSlots = async () => {
    const { data } = await supabase
      .from('bookings')
      .select('appointment_date')
      .is('deleted_at', null);
    
    if (data) {
      setBookedSlots(data.map(booking => new Date(booking.appointment_date)));
    }
  };

  const updateAvailableTimeSlots = (selectedDate: Date) => {
    // Generate time slots based on work hours from settings
    const timeSlots = generateTimeSlots(
      settings?.workStartTime || '09:00',
      settings?.workEndTime || '20:00'
    );
    
    const minIntervalMs = (settings?.minIntervalHours || 3) * 60 * 60 * 1000;
    
    const available = timeSlots.filter(time => {
      const [hours, minutes] = time.split(':').map(Number);
      const timeToCheck = new Date(selectedDate);
      timeToCheck.setHours(hours, minutes, 0, 0);

      return !bookedSlots.some(bookedSlot => {
        const diff = Math.abs(timeToCheck.getTime() - bookedSlot.getTime());
        return diff < minIntervalMs;
      });
    });

    setAvailableTimeSlots(available);
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const getCurrentLanguage = () => {
    return i18n.language?.split('-')[0] || i18n.language || 'ru';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.appointmentDate || !formData.appointmentTime) {
      toast.error(t('selectDateTime'));
      return;
    }

    setIsSubmitting(true);

    try {
      const appointmentDateTime = new Date(formData.appointmentDate);
      const [hours, minutes] = formData.appointmentTime.split(':').map(Number);
      appointmentDateTime.setHours(hours, minutes, 0, 0);

      const { data, error } = await supabase
        .from('bookings')
        .insert([
          {
            first_name: formData.firstName,
            last_name: formData.lastName,
            phone: formData.phone,
            address: formData.address,
            city: formData.city || null,
            operating_system: formData.operatingSystem,
            comments: formData.comments,
            appointment_date: appointmentDateTime.toISOString()
          }
        ])
        .select()
        .single();

      if (error) throw error;

      const bookingNumber = data.booking_number || data.id.slice(0, 8);
      toast.success(
        <div>
          {t('bookingSuccess')}
          <br />
          {t('bookingNumber')}: <strong>{bookingNumber}</strong>
        </div>
      );

      // Send SMS only if enabled in settings
      if (settings?.sendSMS !== false) {
        const smsMessage = `${t('smsGreeting')}, ${formData.firstName}! ${t('smsBookingCreated')} #${bookingNumber} ${t('smsAppointmentInfo')} ${appointmentDateTime.toLocaleString()}. ${t('smsContact')}`;

        try {
          const smsResult = await sendSMS(formData.phone, smsMessage);
          
          if (!smsResult.success) {
            console.error('SMS sending failed:', smsResult.error);
            toast(
              <div>
                {t('smsError')}
                <br />
                <small style={{ fontSize: '0.85em', opacity: 0.8 }}>
                  {smsResult.error}
                </small>
              </div>,
              { 
                icon: '⚠️',
                duration: 15000
              }
            );
          }
        } catch (smsError) {
          console.error('SMS sending exception:', smsError);
          toast(
            <div>
              {t('smsError')}
              <br />
              <small style={{ fontSize: '0.85em', opacity: 0.8 }}>
                {smsError instanceof Error ? smsError.message : 'Unknown error'}
              </small>
            </div>,
            { 
              icon: '⚠️',
              duration: 15000
            }
          );
        }
      }
      setFormData({
        firstName: '',
        lastName: '',
        phone: '',
        address: '',
        city: '',
        operatingSystem: '',
        comments: '',
        appointmentDate: null,
        appointmentTime: ''
      });
      
      // Refresh booked slots
      fetchBookedSlots();
    } catch (error) {
      console.error('Booking error:', error);
      toast.error(t('error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper function to format date to YYYY-MM-DD in local time
  const formatDateToYYYYMMDD = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isDateDisabled = ({ date }: { date: Date }) => {
    // Disable past dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    if (checkDate < today) return true;

    // Check disabled weekdays
    const dayOfWeek = date.getDay();
    if (settings?.disabledWeekdays?.includes(dayOfWeek)) return true;

    // Check disabled dates - use local time to avoid timezone issues
    const dateStr = formatDateToYYYYMMDD(date);
    if (settings?.disabledDates?.includes(dateStr)) return true;

    // Check maximum bookings per day
    if (settings?.maxBookingsPerDay !== null && settings?.maxBookingsPerDay !== undefined) {
      const dateStart = new Date(date);
      dateStart.setHours(0, 0, 0, 0);
      const dateEnd = new Date(date);
      dateEnd.setHours(23, 59, 59, 999);
      
      const bookingsOnDate = bookedSlots.filter(bookedSlot => {
        const slotDate = new Date(bookedSlot);
        return slotDate >= dateStart && slotDate <= dateEnd;
      }).length;
      
      if (bookingsOnDate >= settings.maxBookingsPerDay) {
        return true;
      }
    }

    // Check if there are any available time slots for this date
    const timeSlots = generateTimeSlots(
      settings?.workStartTime || '09:00',
      settings?.workEndTime || '20:00'
    );
    const minIntervalMs = (settings?.minIntervalHours || 3) * 60 * 60 * 1000;
    
    const hasAvailableSlots = timeSlots.some(time => {
      const [hours, minutes] = time.split(':').map(Number);
      const timeToCheck = new Date(date);
      timeToCheck.setHours(hours, minutes, 0, 0);

      return !bookedSlots.some(bookedSlot => {
        const diff = Math.abs(timeToCheck.getTime() - bookedSlot.getTime());
        return diff < minIntervalMs;
      });
    });

    // Disable date if no available time slots
    return !hasAvailableSlots;
  };

  if (showAdmin) {
    return <AdminView onLogout={() => setShowAdmin(false)} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" />
      
      {/* Language Switcher and Admin Toggle */}
      <div className="fixed top-4 right-4 flex gap-2">
        <button onClick={() => setShowAdmin(true)} className="px-3 py-1 rounded bg-white shadow hover:bg-gray-100">
          <WrenchIcon className="w-4 h-4" />
        </button>
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

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <Globe className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-800">{t('title')}</h1>
          </div>
          <p className="text-gray-600 mb-8">{t('subtitle')}</p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">{t('firstName')} *</label>
                <input
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">{t('lastName')} *</label>
                <input
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">{t('phone')} *</label>
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">{t('city')}</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">{t('address')} *</label>
              <input
                type="text"
                required
                value={formData.address}
                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">{t('operatingSystem')} *</label>
              <select
                required
                value={formData.operatingSystem}
                onChange={(e) => setFormData(prev => ({ ...prev, operatingSystem: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">{t('selectOs')}</option>
                {OPERATING_SYSTEMS.map(os => (
                  <option key={os} value={os}>{t(os)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">{t('comments')}</label>
              <textarea
                value={formData.comments}
                onChange={(e) => setFormData(prev => ({ ...prev, comments: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                rows={3}
              />
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {t('appointmentDate')} *
                </div>
              </label>
              <Calendar
                key={`${bookedSlots.length}-${settings?.firstDayOfWeek || 1}-${settings?.disabledWeekdays?.join(',') || ''}-${settings?.disabledDates?.join(',') || ''}-${settings?.minIntervalHours || 3}-${settings?.workStartTime || '09:00'}-${settings?.workEndTime || '20:00'}-${settings?.maxBookingsPerDay ?? 'null'}-${i18n.language}`}
                onChange={(date) => setFormData(prev => ({ ...prev, appointmentDate: date as Date, appointmentTime: '' }))}
                value={formData.appointmentDate}
                minDate={new Date()}
                tileDisabled={isDateDisabled}
                locale={getCalendarLocale()}
                calendarType={settings?.firstDayOfWeek === 0 ? 'gregory' : undefined}
                className="w-full border rounded-lg p-4"
              />

              {formData.appointmentDate && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('appointmentTime')} *
                  </label>
                  <select
                    required
                    value={formData.appointmentTime}
                    onChange={(e) => setFormData(prev => ({ ...prev, appointmentTime: e.target.value }))}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">{t('selectTime')}</option>
                    {availableTimeSlots.map(time => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t('submitting') : t('submit')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;