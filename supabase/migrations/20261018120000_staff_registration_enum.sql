-- Technician self-registration uses the shared verification challenge flow.
-- The new enum value must be committed before it is referenced (next migration).

ALTER TYPE public.verification_purpose ADD VALUE IF NOT EXISTS 'staff_registration';
