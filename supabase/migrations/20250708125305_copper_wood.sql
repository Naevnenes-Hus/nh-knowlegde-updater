/*
  # Create persistent operations table

  1. New Table
    - `persistent_operations`
      - `id` (text, primary key) - operation ID
      - `type` (text) - operation type (fetch_entries, update_sitemap, etc.)
      - `site_id` (uuid) - reference to site
      - `site_name` (text) - site name for display
      - `site_url` (text) - site URL
      - `status` (text) - running, paused, completed, failed
      - `progress` (jsonb) - progress information
      - `start_time` (bigint) - start timestamp
      - `last_update_time` (bigint) - last update timestamp
      - `max_entries` (integer) - max entries setting
      - `guids_to_fetch` (jsonb) - array of GUIDs to fetch
      - `processed_guids` (jsonb) - array of processed GUIDs
      - `failed_guids` (jsonb) - array of failed GUIDs
      - `message` (text) - current status message
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on persistent_operations table
    - Add policy for public access (single-user app)

  3. Indexes
    - Add performance indexes
*/

-- Create persistent operations table for production
CREATE TABLE IF NOT EXISTS persistent_operations (
  id text PRIMARY KEY,
  type text NOT NULL,
  site_id uuid NOT NULL,
  site_name text NOT NULL,
  site_url text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  progress jsonb DEFAULT '{"current": 0, "total": 0}',
  start_time bigint NOT NULL,
  last_update_time bigint NOT NULL,
  max_entries integer DEFAULT 0,
  guids_to_fetch jsonb DEFAULT '[]',
  processed_guids jsonb DEFAULT '[]',
  failed_guids jsonb DEFAULT '[]',
  message text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Create persistent operations table for development
CREATE TABLE IF NOT EXISTS dev_persistent_operations (
  id text PRIMARY KEY,
  type text NOT NULL,
  site_id uuid NOT NULL,
  site_name text NOT NULL,
  site_url text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  progress jsonb DEFAULT '{"current": 0, "total": 0}',
  start_time bigint NOT NULL,
  last_update_time bigint NOT NULL,
  max_entries integer DEFAULT 0,
  guids_to_fetch jsonb DEFAULT '[]',
  processed_guids jsonb DEFAULT '[]',
  failed_guids jsonb DEFAULT '[]',
  message text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE persistent_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dev_persistent_operations ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (single-user app)
CREATE POLICY "Allow all operations on persistent_operations"
  ON persistent_operations
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on dev_persistent_operations"
  ON dev_persistent_operations
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_persistent_operations_status ON persistent_operations(status);
CREATE INDEX IF NOT EXISTS idx_persistent_operations_site_id ON persistent_operations(site_id);
CREATE INDEX IF NOT EXISTS idx_persistent_operations_last_update ON persistent_operations(last_update_time);

CREATE INDEX IF NOT EXISTS idx_dev_persistent_operations_status ON dev_persistent_operations(status);
CREATE INDEX IF NOT EXISTS idx_dev_persistent_operations_site_id ON dev_persistent_operations(site_id);
CREATE INDEX IF NOT EXISTS idx_dev_persistent_operations_last_update ON dev_persistent_operations(last_update_time);