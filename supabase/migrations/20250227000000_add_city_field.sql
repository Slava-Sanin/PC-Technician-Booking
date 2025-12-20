/*
  # Add city field to bookings table

  1. Changes
    - Add `city` column (text, nullable) to `bookings` table
*/

ALTER TABLE bookings 
  ADD COLUMN IF NOT EXISTS city TEXT;

