import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Badge, DotSep, DisplayDateInput, EmptyState, Select } from '../ui';
import type { Booking } from '../../types/booking';
import { BOOKING_STATUSES, type BookingStatus } from '../../types/booking';
import { BUSINESS_TIME_ZONE, formatAppointmentInZone, getZonedParts, todayISOInTimeZone } from '../../utils/dateTime';
import { formatBookingLocation } from '../../utils/formatBookingLocation';
import { bookingGeocodeQuery, geocodeBookingsSequential, type GeoPoint } from '../../utils/geocode';
import { isCivilDateInRange, resolveMapPeriodRange, type MapPeriodPreset } from '../../utils/mapPeriod';
import 'leaflet/dist/leaflet.css';

const ISRAEL_CENTER: GeoPoint = { lat: 31.5, lng: 34.75 };
const DEFAULT_ZOOM = 8;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function bookingCivilDate(booking: Booking): string {
  const raw = booking.appointment_start || booking.appointment_date;
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = getZonedParts(new Date(raw), BUSINESS_TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function MapFitBounds({ points }: { points: GeoPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) {
      map.setView([ISRAEL_CENTER.lat, ISRAEL_CENTER.lng], DEFAULT_ZOOM);
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 14);
      return;
    }
    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
  }, [map, points]);
  return null;
}

export function BookingsMapPanel({ bookings }: { bookings: Booking[] }) {
  const { t } = useTranslation();
  const today = todayISOInTimeZone(BUSINESS_TIME_ZONE);
  const [preset, setPreset] = useState<MapPeriodPreset>('week');
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [status, setStatus] = useState<BookingStatus | 'all'>('all');
  const [points, setPoints] = useState<Map<string, GeoPoint>>(new Map());
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState({ done: 0, total: 0 });
  const [geocodeFailed, setGeocodeFailed] = useState(0);

  const range = useMemo(
    () => resolveMapPeriodRange(preset, today, customFrom, customTo),
    [preset, today, customFrom, customTo],
  );

  const filtered = useMemo(() => {
    return bookings.filter((booking) => {
      if (booking.deleted_at) return false;
      if (status !== 'all' && booking.status !== status) return false;
      const day = bookingCivilDate(booking);
      if (!day || !isCivilDateInRange(day, range)) return false;
      return Boolean(bookingGeocodeQuery(booking));
    });
  }, [bookings, range, status]);

  const markers = useMemo(() => {
    return filtered
      .map((booking) => {
        const point = points.get(booking.id);
        if (!point) return null;
        return { booking, point };
      })
      .filter((item): item is { booking: Booking; point: GeoPoint } => item !== null);
  }, [filtered, points]);

  useEffect(() => {
    const controller = new AbortController();
    const queries = filtered.map((booking) => ({
      id: booking.id,
      query: bookingGeocodeQuery(booking)!,
    }));

    setGeocoding(queries.length > 0);
    setGeocodeProgress({ done: 0, total: queries.length });
    setGeocodeFailed(0);

    void (async () => {
      try {
        const resolved = await geocodeBookingsSequential(queries, controller.signal, (done, total) => {
          setGeocodeProgress({ done, total });
        });
        if (controller.signal.aborted) return;
        setPoints(resolved);
        setGeocodeFailed(queries.length - resolved.size);
      } catch {
        if (!controller.signal.aborted) setGeocodeFailed(queries.length);
      } finally {
        if (!controller.signal.aborted) setGeocoding(false);
      }
    })();

    return () => controller.abort();
  }, [filtered]);

  const mapPoints = useMemo(() => markers.map((item) => item.point), [markers]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('nav_map')}</h1>
        <p className="text-sm text-muted">
          {t('map_period_label')}: {range.start} — {range.end}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Select value={preset} onChange={(event) => setPreset(event.target.value as MapPeriodPreset)} aria-label={t('map_period_label')}>
          <option value="day">{t('map_period_day')}</option>
          <option value="week">{t('map_period_week')}</option>
          <option value="month">{t('map_period_month')}</option>
          <option value="year">{t('map_period_year')}</option>
          <option value="custom">{t('map_period_custom')}</option>
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value as BookingStatus | 'all')} aria-label={t('filterStatus')}>
          <option value="all">{t('allStatuses')}</option>
          {BOOKING_STATUSES.map((item) => (
            <option key={item} value={item}>
              {t(`status_${item}`)}
            </option>
          ))}
        </Select>
        {preset === 'custom' ? (
          <>
            <DisplayDateInput value={customFrom} onChange={setCustomFrom} aria-label={t('dateFrom')} />
            <DisplayDateInput value={customTo} onChange={setCustomTo} aria-label={t('dateTo')} />
          </>
        ) : (
          <div className="md:col-span-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{t('map_bookings_in_period', { count: filtered.length })}</span>
            <DotSep />
            <span>{t('map_points_on_map', { count: markers.length })}</span>
            {geocodeFailed > 0 ? (
              <>
                <DotSep />
                <span>{t('map_geocode_failed', { count: geocodeFailed })}</span>
              </>
            ) : null}
          </div>
        )}
      </div>

      {preset === 'custom' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{t('map_bookings_in_period', { count: filtered.length })}</span>
          <DotSep />
          <span>{t('map_points_on_map', { count: markers.length })}</span>
          {geocodeFailed > 0 ? (
            <>
              <DotSep />
              <span>{t('map_geocode_failed', { count: geocodeFailed })}</span>
            </>
          ) : null}
        </div>
      ) : null}

      {geocoding ? (
        <p className="text-sm text-muted">
          {t('map_geocoding', { done: geocodeProgress.done, total: geocodeProgress.total })}
        </p>
      ) : null}

      {filtered.length === 0 ? <EmptyState title={t('noBookings')} /> : null}

      <div className="overflow-hidden rounded-2xl border border-line shadow-card">
        <MapContainer
          center={[ISRAEL_CENTER.lat, ISRAEL_CENTER.lng]}
          zoom={DEFAULT_ZOOM}
          className="h-[min(70vh,640px)] w-full"
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapFitBounds points={mapPoints} />
          {markers.map(({ booking, point }) => (
            <Marker key={booking.id} position={[point.lat, point.lng]}>
              <Popup>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">{booking.booking_number}</p>
                  <p>
                    {booking.first_name} {booking.last_name}
                  </p>
                  <p>{booking.phone}</p>
                  <p>
                    {formatBookingLocation(booking.city, booking.address)}
                  </p>
                  <p>{formatAppointmentInZone(booking.appointment_start || booking.appointment_date, BUSINESS_TIME_ZONE)}</p>
                  <Badge tone="info">{t(`status_${booking.status}`)}</Badge>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

    </div>
  );
}
