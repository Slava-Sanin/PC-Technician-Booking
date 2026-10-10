import { useEffect, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import type { Booking } from '../../types/booking';
import { formatBookingLocation } from '../../utils/formatBookingLocation';
import { bookingGeocodeQuery, geocodeLocationQuery, type GeoPoint } from '../../utils/geocode';
import { EmptyState, Modal } from '../ui';
import 'leaflet/dist/leaflet.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function MapCenter({ point }: { point: GeoPoint }) {
  const map = useMap();
  useEffect(() => {
    map.setView([point.lat, point.lng], 16);
  }, [map, point]);
  return null;
}

export function BookingAddressMapModal({
  booking,
  onClose,
}: {
  booking: Booking;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const location = formatBookingLocation(booking.city, booking.address);
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const query = bookingGeocodeQuery(booking);
    if (!query) {
      setLoading(false);
      setFailed(true);
      return;
    }

    setLoading(true);
    setFailed(false);
    void geocodeLocationQuery(query, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result) {
          setPoint(result);
          setFailed(false);
        } else {
          setPoint(null);
          setFailed(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [booking]);

  return (
    <Modal title={booking.booking_number} onClose={onClose}>
      {location ? <p className="mb-3 text-sm text-muted" dir="auto">{location}</p> : null}
      {loading ? <p className="text-sm text-muted">{t('loading')}</p> : null}
      {!loading && failed ? <EmptyState title={t('map_address_not_found')} /> : null}
      {!loading && point ? (
        <div className="h-72 overflow-hidden rounded-xl border border-line sm:h-96">
          <MapContainer center={[point.lat, point.lng]} zoom={16} className="h-full w-full" scrollWheelZoom>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapCenter point={point} />
            <Marker position={[point.lat, point.lng]} />
          </MapContainer>
        </div>
      ) : null}
    </Modal>
  );
}
