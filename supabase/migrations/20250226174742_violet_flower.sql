/*
  # Fix booking number generation

  1. Changes
     - Modify the booking number generation function to ensure uniqueness
     - Add a fallback mechanism to handle concurrent inserts
     - Improve the booking number format to include a random component

  2. Security
     - No security changes
*/

-- Drop the existing trigger first
DROP TRIGGER IF EXISTS set_booking_number ON bookings;

-- Drop the existing function
DROP FUNCTION IF EXISTS generate_booking_number();

-- Create an improved function for generating unique booking numbers
CREATE OR REPLACE FUNCTION generate_booking_number()
RETURNS TRIGGER AS $$
DECLARE
    base_number TEXT;
    random_suffix TEXT;
    attempt_count INTEGER := 0;
    max_attempts INTEGER := 10;
    is_unique BOOLEAN := FALSE;
BEGIN
    -- Generate base number with date prefix
    base_number := 'BK-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDD');
    
    -- Loop until we find a unique booking number or reach max attempts
    WHILE NOT is_unique AND attempt_count < max_attempts LOOP
        -- Generate a random 4-character suffix
        random_suffix := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
        
        -- Combine with a sequential counter based on today's bookings
        NEW.booking_number := base_number || '-' || 
                            LPAD((SELECT COUNT(*) + 1 + attempt_count FROM bookings 
                                 WHERE DATE_TRUNC('day', created_at) = DATE_TRUNC('day', CURRENT_TIMESTAMP))::TEXT, 
                                 3, '0') || 
                            random_suffix;
        
        -- Check if this booking number already exists
        PERFORM 1 FROM bookings WHERE booking_number = NEW.booking_number;
        
        -- If no rows returned, the booking number is unique
        is_unique := NOT FOUND;
        
        -- Increment attempt counter
        attempt_count := attempt_count + 1;
    END LOOP;
    
    -- If we couldn't generate a unique number after max attempts, use UUID as fallback
    IF NOT is_unique THEN
        NEW.booking_number := base_number || '-' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger again
CREATE TRIGGER set_booking_number
    BEFORE INSERT ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION generate_booking_number();

-- Update any NULL booking numbers with unique values
DO $$
DECLARE
    r RECORD;
    new_booking_number TEXT;
BEGIN
    FOR r IN SELECT id FROM bookings WHERE booking_number IS NULL
    LOOP
        -- Generate a unique booking number for each record
        new_booking_number := 'BK-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                             SUBSTRING(gen_random_uuid()::TEXT, 1, 8);
        
        -- Update the record
        UPDATE bookings 
        SET booking_number = new_booking_number
        WHERE id = r.id;
    END LOOP;
END $$;