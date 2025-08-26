/*
  # Create development tables

  1. New Tables for Development Environment
    - `dev_sites` - Development version of sites table
    - `dev_entries` - Development version of entries table  
    - `dev_sitemaps` - Development version of sitemaps table

  2. Security
    - Enable RLS on all development tables
    - Add policies for public access (single-user app)

  3. Indexes
    - Add performance indexes for development tables
*/

-- Create development tables (prefixed with dev_)
CREATE TABLE IF NOT EXISTS dev_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text UNIQUE NOT NULL,
  name text NOT NULL,
  last_updated timestamptz DEFAULT now(),
  entry_count integer DEFAULT 0,
  sitemap_entry_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dev_entries (
  id text PRIMARY KEY,
  site_id uuid REFERENCES dev_sites(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  abstract text DEFAULT '',
  body text DEFAULT '',
  published_date text DEFAULT '',
  type text DEFAULT 'publication',
  seen boolean DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dev_sitemaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES dev_sites(id) ON DELETE CASCADE,
  guid text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(site_id, guid)
);

-- Enable RLS on development tables
ALTER TABLE dev_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE dev_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE dev_sitemaps ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (single-user app)
CREATE POLICY "Allow all operations on dev_sites"
  ON dev_sites
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on dev_entries"
  ON dev_entries
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on dev_sitemaps"
  ON dev_sitemaps
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Create indexes for better performance on development tables
CREATE INDEX IF NOT EXISTS idx_dev_entries_site_id ON dev_entries(site_id);
CREATE INDEX IF NOT EXISTS idx_dev_entries_published_date ON dev_entries(published_date);
CREATE INDEX IF NOT EXISTS idx_dev_entries_seen ON dev_entries(seen);
CREATE INDEX IF NOT EXISTS idx_dev_sitemaps_site_id ON dev_sitemaps(site_id);