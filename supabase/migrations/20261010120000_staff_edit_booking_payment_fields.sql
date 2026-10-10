-- Allow staff to edit payment and amount fields on bookings; keep them protected for customers.

CREATE OR REPLACE FUNCTION public.protect_booking_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id;
    NEW.booking_number := OLD.booking_number;
    NEW.created_at := OLD.created_at;
    IF auth.role() = 'authenticated' AND NOT public.is_staff() THEN
      NEW.subtotal := OLD.subtotal;
      NEW.total_amount := OLD.total_amount;
      NEW.currency := OLD.currency;
      NEW.payment_status := OLD.payment_status;
      NEW.payment_expires_at := OLD.payment_expires_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
