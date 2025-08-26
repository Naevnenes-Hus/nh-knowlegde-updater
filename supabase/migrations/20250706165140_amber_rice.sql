/*
  # Create knowledge storage tables

  1. New Tables
    - `sites`
      - `id` (uuid, primary key)
      - `url` (text, unique)
      - `name` (text)
      - `last_updated` (timestamp)
      - `entry_count` (integer)
      - `sitemap_entry_count` (integer)
      - `created_at` (timestamp)
    - `entries`
      - `id` (text, primary key) - GUID from the API
      - `site_id` (uuid, foreign key)
      - `title` (text)
      - `abstract` (text)
      - `body` (text)
      - `published_date` (text)
      - `type` (text)
      - `seen` (boolean)
      - `metadata` (jsonb)
      - `created_at` (timestamp)
    - `sitemaps`
      - `id` (uuid, primary key)
      - `site_id` (uuid, foreign key)
      - `guid` (text)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on all tables
    - Add policies for public access (since this is a single-user app)
*/

CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text UNIQUE NOT NULL,
  name text NOT NULL,
  last_updated timestamptz DEFAULT now(),
  entry_count integer DEFAULT 0,
  sitemap_entry_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
  id text PRIMARY KEY,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  abstract text DEFAULT '',
  body text DEFAULT '',
  published_date text DEFAULT '',
  type text DEFAULT 'publication',
  seen boolean DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sitemaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  guid text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(site_id, guid)
);

-- Enable RLS
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sitemaps ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (single-user app)
CREATE POLICY "Allow all operations on sites"
  ON sites
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on entries"
  ON entries
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on sitemaps"
  ON sitemaps
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_entries_site_id ON entries(site_id);
CREATE INDEX IF NOT EXISTS idx_entries_published_date ON entries(published_date);
CREATE INDEX IF NOT EXISTS idx_entries_seen ON entries(seen);
CREATE INDEX IF NOT EXISTS idx_sitemaps_site_id ON sitemaps(site_id);