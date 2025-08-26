/*
  # Create background export jobs table

  1. New Tables
    - `background_export_jobs`
      - `id` (text, primary key) - Unique job identifier
      - `type` (text) - Export type: single_site, all_sites, sync
      - `status` (text) - Job status: queued, processing, completed, failed
      - `progress` (jsonb) - Progress information with current, total, step, currentSite
      - `site_id` (uuid, nullable) - Site ID for single site exports
      - `site_name` (text) - Site name for display
      - `file_name` (text, nullable) - Generated file name
      - `download_url` (text, nullable) - Signed URL for download
      - `error_message` (text, nullable) - Error message if failed
      - `estimated_size` (integer, nullable) - Estimated file size in bytes
      - `created_at` (timestamptz) - When job was created
      - `completed_at` (timestamptz, nullable) - When job was completed

    - `dev_background_export_jobs` (development version)
      - Same structure as above for development environment

  2. Security
    - Enable RLS on both tables
    - Add policies for public access (since this is a single-user application)

  3. Indexes
    - Index on status for filtering active jobs
    - Index on created_at for cleanup operations
    - Index on completed_at for recent completed jobs
*/

-- Production table
CREATE TABLE IF NOT EXISTS background_export_jobs (
  id text PRIMARY KEY,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  progress jsonb DEFAULT '{"current": 0, "total": 0, "step": "", "currentSite": ""}'::jsonb,
  site_id uuid,
  site_name text,
  file_name text,
  download_url text,
  error_message text,
  estimated_size integer,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Development table
CREATE TABLE IF NOT EXISTS dev_background_export_jobs (
  id text PRIMARY KEY,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  progress jsonb DEFAULT '{"current": 0, "total": 0, "step": "", "currentSite": ""}'::jsonb,
  site_id uuid,
  site_name text,
  file_name text,
  download_url text,
  error_message text,
  estimated_size integer,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Enable RLS
ALTER TABLE background_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dev_background_export_jobs ENABLE ROW LEVEL SECURITY;

-- Create policies for public access
CREATE POLICY "Allow all operations on background_export_jobs"
  ON background_export_jobs
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on dev_background_export_jobs"
  ON dev_background_export_jobs
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_background_export_jobs_status ON background_export_jobs(status);
CREATE INDEX IF NOT EXISTS idx_background_export_jobs_created_at ON background_export_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_background_export_jobs_completed_at ON background_export_jobs(completed_at);

CREATE INDEX IF NOT EXISTS idx_dev_background_export_jobs_status ON dev_background_export_jobs(status);
CREATE INDEX IF NOT EXISTS idx_dev_background_export_jobs_created_at ON dev_background_export_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_dev_background_export_jobs_completed_at ON dev_background_export_jobs(completed_at);

-- Create storage bucket for export files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('export-files', 'export-files', false)
ON CONFLICT (id) DO NOTHING;

-- Create storage policy for export files
CREATE POLICY "Allow authenticated users to upload export files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'export-files');

CREATE POLICY "Allow authenticated users to read export files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'export-files');

CREATE POLICY "Allow service role to manage export files"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'export-files');