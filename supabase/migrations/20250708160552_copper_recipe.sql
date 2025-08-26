/*
  # Remove processed_guids column from persistent operations tables

  This migration removes the processed_guids column from both persistent_operations 
  and dev_persistent_operations tables to resolve database timeout issues caused 
  by frequent updates of large JSONB arrays.

  ## Changes
  1. Remove processed_guids column from persistent_operations table
  2. Remove processed_guids column from dev_persistent_operations table

  ## Background
  The processed_guids column was causing statement timeouts when operations 
  processed large numbers of entries, as the JSONB array would grow very large 
  and be updated frequently. The application now calculates processed GUIDs 
  dynamically by querying the entries table instead.
*/

-- Remove processed_guids column from persistent_operations table
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'persistent_operations' AND column_name = 'processed_guids'
  ) THEN
    ALTER TABLE persistent_operations DROP COLUMN processed_guids;
  END IF;
END $$;

-- Remove processed_guids column from dev_persistent_operations table
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dev_persistent_operations' AND column_name = 'processed_guids'
  ) THEN
    ALTER TABLE dev_persistent_operations DROP COLUMN processed_guids;
  END IF;
END $$;