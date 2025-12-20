/*
  # Update bookings table policies

  This migration ensures the bookings table exists and has the correct policies.
  It uses IF NOT EXISTS checks to avoid conflicts with existing policies.

  1. Table Structure
    - Ensures bookings table exists with all required fields
  
  2. Security
    - Enables RLS if not already enabled
    - Creates policies for public booking creation and technician access (if they don't exist)
*/

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  operating_system text NOT NULL,
  comments text,
  appointment_date timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  completed boolean DEFAULT false,
  technician_notes text
);

-- Enable RLS
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'bookings' 
    AND rowsecurity = true
  ) THEN
    ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Create policies if they don't exist
DO $$ 
BEGIN
  -- Check and create insert policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'bookings' 
    AND policyname = 'Anyone can create bookings'
  ) THEN
    CREATE POLICY "Anyone can create bookings"
      ON bookings
      FOR INSERT
      TO public
      WITH CHECK (true);
  END IF;

  -- Check and create select policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'bookings' 
    AND policyname = 'Technicians can view bookings'
  ) THEN
    CREATE POLICY "Technicians can view bookings"
      ON bookings
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  -- Check and create update policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'bookings' 
    AND policyname = 'Technicians can update bookings'
  ) THEN
    CREATE POLICY "Technicians can update bookings"
      ON bookings
      FOR UPDATE
      TO authenticated
      USING (true);
  END IF;
END $$;