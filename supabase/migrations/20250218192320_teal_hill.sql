/*
  # Create bookings table

  1. New Tables
    - `bookings`
      - `id` (uuid, primary key)
      - `first_name` (text)
      - `last_name` (text)
      - `phone` (text)
      - `address` (text)
      - `operating_system` (text)
      - `comments` (text)
      - `appointment_date` (timestamptz)
      - `created_at` (timestamptz)
      - `completed` (boolean)
      - `technician_notes` (text)
  
  2. Security
    - Enable RLS on `bookings` table
    - Add policies for public access to create bookings
    - Add policies for authenticated users (technicians) to read and update bookings
*/

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

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Allow public to create bookings
CREATE POLICY "Anyone can create bookings"
  ON bookings
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Allow authenticated users (technicians) to read all bookings
CREATE POLICY "Technicians can view bookings"
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