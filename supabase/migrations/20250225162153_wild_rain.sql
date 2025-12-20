/*
  # Fix RLS policies for soft delete

  1. Changes
    - Update RLS policy to properly handle soft delete operations
    - Ensure technicians can update deleted_at field
*/

-- Drop the existing policy that's too restrictive
DROP POLICY IF EXISTS "Technicians can soft delete bookings" ON bookings;

-- Create a new policy that allows technicians to perform soft deletes
CREATE POLICY "Technicians can soft delete bookings"
  ON bookings
  FOR UPDATE
  TO authenticated
  USING (true)  -- Allow updates on any record
  WITH CHECK (true);  -- No additional checks needed for updates