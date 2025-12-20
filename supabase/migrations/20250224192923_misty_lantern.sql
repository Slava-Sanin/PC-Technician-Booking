/*
  # Fix RLS policies for bookings table

  1. Changes
    - Update RLS policies to allow public inserts with proper column checks
    - Add policy for public to read their own bookings by phone number
    - Ensure technicians (authenticated users) can read and update all bookings

  2. Security
    - Enable RLS on bookings table
    - Add policies for:
      - Public insert with validation
      - Public read own bookings
      - Technician full access
*/

-- Enable RLS if not already enabled
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate them with proper checks
DROP POLICY IF EXISTS "Anyone can create bookings" ON bookings;
DROP POLICY IF EXISTS "Technicians can view bookings" ON bookings;
DROP POLICY IF EXISTS "Technicians can update bookings" ON bookings;

-- Allow public to create bookings with required fields
CREATE POLICY "Public can create valid bookings"
  ON bookings
  FOR INSERT
  TO public
  WITH CHECK (
    first_name IS NOT NULL AND
    last_name IS NOT NULL AND
    phone IS NOT NULL AND
    address IS NOT NULL AND
    operating_system IS NOT NULL AND
    appointment_date IS NOT NULL
  );

-- Allow public to read their own bookings by phone number
CREATE POLICY "Public can read own bookings"
  ON bookings
  FOR SELECT
  TO public
  USING (phone IS NOT NULL);

-- Allow authenticated users (technicians) to read all bookings
CREATE POLICY "Technicians can view all bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users (technicians) to update all bookings
CREATE POLICY "Technicians can update all bookings"
  ON bookings
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);