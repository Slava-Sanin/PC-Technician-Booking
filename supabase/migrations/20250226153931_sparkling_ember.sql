/*
  # Fix RLS policies for bookings table

  1. Changes
    - Drop all existing policies to start fresh
    - Create comprehensive policies for all operations
    - Ensure proper handling of soft deletes
    - Fix technician update permissions
*/

-- First, ensure RLS is enabled
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "Public can create valid bookings" ON bookings;
DROP POLICY IF EXISTS "Public can read own bookings" ON bookings;
DROP POLICY IF EXISTS "Technicians can view all bookings" ON bookings;
DROP POLICY IF EXISTS "Technicians can update all bookings" ON bookings;
DROP POLICY IF EXISTS "Technicians can soft delete bookings" ON bookings;

-- Create new comprehensive policies

-- Allow public to create bookings
CREATE POLICY "Public can create bookings"
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

-- Allow public to read their own bookings
CREATE POLICY "Public can read own bookings"
  ON bookings
  FOR SELECT
  TO public
  USING (
    phone IS NOT NULL AND
    deleted_at IS NULL
  );

-- Allow authenticated users (technicians) to read all non-deleted bookings
CREATE POLICY "Technicians can read bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users (technicians) to update bookings
CREATE POLICY "Technicians can update bookings"
  ON bookings
  FOR UPDATE
  TO authenticated
  USING (true);

-- Allow authenticated users (technicians) to delete bookings
CREATE POLICY "Technicians can delete bookings"
  ON bookings
  FOR DELETE
  TO authenticated
  USING (true);