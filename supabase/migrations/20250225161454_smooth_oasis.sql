/*
  # Update bookings table structure

  1. Changes
    - Add booking_number field (unique, text)
    - Add updated_at timestamp
    - Add deleted_at timestamp for soft delete
    - Add triggers for automatic field updates
    - Update RLS policies to handle soft delete

  2. Security
    - Update existing policies to respect soft delete
    - Add policy for soft delete operations
*/

-- Add new columns
ALTER TABLE bookings 
  ADD COLUMN IF NOT EXISTS booking_number TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to generate booking number
CREATE OR REPLACE FUNCTION generate_booking_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.booking_number = 'BK-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDD') || '-' || 
                        LPAD(COALESCE(
                            (SELECT COUNT(*) + 1 FROM bookings 
                             WHERE DATE_TRUNC('day', created_at) = DATE_TRUNC('day', CURRENT_TIMESTAMP)
                            )::text, '1'), 4, '0');
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for booking number
DROP TRIGGER IF EXISTS set_booking_number ON bookings;
CREATE TRIGGER set_booking_number
    BEFORE INSERT ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION generate_booking_number();

-- Update existing policies to respect soft delete
DROP POLICY IF EXISTS "Public can read own bookings" ON bookings;
CREATE POLICY "Public can read own bookings"
  ON bookings
  FOR SELECT
  TO public
  USING (phone IS NOT NULL AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Technicians can view all bookings" ON bookings;
CREATE POLICY "Technicians can view all bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL);

-- Add policy for soft delete
CREATE POLICY "Technicians can soft delete bookings"
  ON bookings
  FOR UPDATE
  TO authenticated
  USING (deleted_at IS NULL)
  WITH CHECK (true);

-- Update existing records with booking numbers using a more compatible approach
DO $$
DECLARE
    r RECORD;
    counter INTEGER;
    booking_date DATE;
BEGIN
    FOR r IN SELECT id, created_at FROM bookings WHERE booking_number IS NULL ORDER BY created_at
    LOOP
        -- Reset counter when date changes
        IF booking_date IS NULL OR booking_date != DATE_TRUNC('day', r.created_at::timestamp) THEN
            booking_date := DATE_TRUNC('day', r.created_at::timestamp);
            counter := 1;
        ELSE
            counter := counter + 1;
        END IF;

        -- Update the booking number
        UPDATE bookings 
        SET 
            booking_number = 'BK-' || TO_CHAR(r.created_at, 'YYYYMMDD') || '-' || LPAD(counter::text, 4, '0'),
            updated_at = created_at
        WHERE id = r.id;
    END LOOP;
END $$;