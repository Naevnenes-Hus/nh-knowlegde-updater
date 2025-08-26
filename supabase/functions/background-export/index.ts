const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface Site {
  id: string;
  url: string;
  name: string;
}

interface Entry {
  id: string;
  title: string;
  abstract: string;
  body: string;
  published_date: string;
  type: string;
  seen: boolean;
  metadata: any;
}

interface ExportJob {
  jobId: string;
  type: 'single_site' | 'all_sites' | 'sync';
  sites: Site[];
  siteId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Force redeploy - updated timestamp
    const job: ExportJob = await req.json();
    
    console.log(`Starting background export job: ${job.jobId} (${job.type})`);
    
    // Update job status to processing
    await updateJobStatus(job.jobId, 'processing', {
      current: 0,
      total: 100,
      step: 'initializing',
      currentSite: ''
    });

    // Process the export based on type
    let fileName: string;
    let exportContent: string;
    
    switch (job.type) {
      case 'single_site':
        if (!job.siteId) {
          throw new Error('Site ID required for single site export');
        }
        const site = job.sites.find(s => s.id === job.siteId);
        if (!site) {
          throw new Error('Site not found');
        }
        ({ fileName, exportContent } = await processSingleSiteExport(job.jobId, site));
        break;
        
      case 'all_sites':
        ({ fileName, exportContent } = await processAllSitesExport(job.jobId, job.sites));
        break;

      default:
        throw new Error(`Unknown export type: ${job.type}`);
    }

    // Create blob with proper content
    const exportBlob = new Blob([exportContent], { type: 'text/plain; charset=utf-8' });
    
    // Upload to Supabase Storage
    const downloadUrl = await uploadToStorage(fileName, exportBlob);
    
    // Mark job as completed
    await updateJobStatus(job.jobId, 'completed', {
      current: 100,
      total: 100,
      step: 'completed',
      currentSite: ''
    }, fileName, downloadUrl);

    console.log(`Background export job completed: ${job.jobId}`);
    
    return new Response(
      JSON.stringify({ success: true, jobId: job.jobId, downloadUrl }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
    
  } catch (error) {
    console.error("Background export error:", error);
    
    // Try to mark job as failed if we have a jobId
    try {
      const body = await req.clone().json();
      if (body.jobId) {
        await updateJobStatus(body.jobId, 'failed', {
          current: 0,
          total: 100,
          step: 'failed',
          currentSite: ''
        }, undefined, undefined, error.message);
      }
    } catch (updateError) {
      console.error("Failed to update job status:", updateError);
    }
    
    return new Response(
      JSON.stringify({ error: error?.message || String(error) || "Unknown error occurred" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});

async function processSingleSiteExport(jobId: string, site: Site): Promise<{ fileName: string; exportContent: string }> {
  console.log(`Processing single site export for: ${site.name}`);
  
  await updateJobStatus(jobId, 'processing', {
    current: 10,
    total: 100,
    step: 'loading-entries',
    currentSite: site.name
  });
  
  // Load entries from database
  const entries = await loadEntriesForSite(site);
  console.log(`Loaded ${entries.length} entries for ${site.name}`);
  
  await updateJobStatus(jobId, 'processing', {
    current: 60,
    total: 100,
    step: 'creating-export',
    currentSite: site.name
  });
  
  // Create export content
  const exportContent = createExportContent([{ site, entries }]);
  
  await updateJobStatus(jobId, 'processing', {
    current: 90,
    total: 100,
    step: 'finalizing',
    currentSite: site.name
  });
  
  const timestamp = new Date().toISOString().split('T')[0];
  const fileName = `${sanitizeFileName(site.name)}_entries_${timestamp}.txt`;
  
  return { fileName, exportContent };
}

async function processAllSitesExport(jobId: string, sites: Site[]): Promise<{ fileName: string; exportContent: string }> {
  console.log(`Processing all sites export for ${sites.length} sites`);
  
  const siteExports: { site: Site; entries: Entry[] }[] = [];
  
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    
    await updateJobStatus(jobId, 'processing', {
      current: Math.round((i / sites.length) * 80),
      total: 100,
      step: 'loading-entries',
      currentSite: site.name
    });
    
    try {
      const entries = await loadEntriesForSite(site);
      console.log(`Loaded ${entries.length} entries for ${site.name}`);
      siteExports.push({ site, entries });
    } catch (error) {
      console.error(`Failed to load entries for ${site.name}:`, error);
      // Continue with other sites
      siteExports.push({ site, entries: [] });
    }
  }
  
  await updateJobStatus(jobId, 'processing', {
    current: 85,
    total: 100,
    step: 'creating-export',
    currentSite: ''
  });
  
  const exportContent = createExportContent(siteExports);
  
  const timestamp = new Date().toISOString().split('T')[0];
  const fileName = `all_sites_export_${timestamp}.txt`;
  
  return { fileName, exportContent };
}

async function loadEntriesForSite(site: Site): Promise<Entry[]> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  // Determine table names based on environment
  const environment = Deno.env.get('VITE_ENVIRONMENT') || 'development';
  const sitesTable = environment === 'development' ? 'dev_sites' : 'sites';
  const entriesTable = environment === 'development' ? 'dev_entries' : 'entries';
  
  console.log(`Loading entries for site ${site.name} from ${entriesTable} table`);
  
  // First get the site ID from database
  const siteResponse = await fetch(`${supabaseUrl}/rest/v1/${sitesTable}?url=eq.${encodeURIComponent(site.url)}&select=id`, {
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'apikey': supabaseServiceKey,
    },
  });
  
  if (!siteResponse.ok) {
    throw new Error(`Failed to fetch site: ${siteResponse.statusText}`);
  }
  
  const siteData = await siteResponse.json();
  if (!siteData || siteData.length === 0) {
    console.log(`No site found for URL: ${site.url}`);
    return [];
  }
  
  const siteId = siteData[0].id;
  console.log(`Found site ID: ${siteId} for ${site.name}`);
  
  // Load entries in chunks to avoid timeout
  const allEntries: Entry[] = [];
  const chunkSize = 100;
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    console.log(`Loading entries chunk: offset ${offset}, limit ${chunkSize}`);
    
    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/${entriesTable}?site_id=eq.${siteId}&order=published_date.desc&limit=${chunkSize}&offset=${offset}`,
      {
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
        },
      }
    );
    
    if (!entriesResponse.ok) {
      throw new Error(`Failed to fetch entries: ${entriesResponse.statusText}`);
    }
    
    const entriesChunk = await entriesResponse.json();
    console.log(`Loaded ${entriesChunk.length} entries in chunk`);
    
    if (entriesChunk.length === 0) {
      hasMore = false;
    } else {
      allEntries.push(...entriesChunk);
      offset += entriesChunk.length;
      
      // If we got fewer entries than requested, we've reached the end
      if (entriesChunk.length < chunkSize) {
        hasMore = false;
      }
    }
    
    // Add small delay to prevent overwhelming the database
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`Total entries loaded for ${site.name}: ${allEntries.length}`);
  return allEntries;
}

function createExportContent(siteExports: { site: Site; entries: Entry[] }[]): string {
  const lines: string[] = [];
  
  lines.push('Knowledge Export');
  lines.push('================');
  lines.push('');
  lines.push(`Export Date: ${new Date().toLocaleString()}`);
  lines.push(`Total Sites: ${siteExports.length}`);
  
  const totalEntries = siteExports.reduce((sum, se) => sum + se.entries.length, 0);
  lines.push(`Total Entries: ${totalEntries}`);
  lines.push('');
  
  for (const { site, entries } of siteExports) {
    lines.push(`Site: ${site.name}`);
    lines.push(`URL: ${site.url}`);
    lines.push(`Entries: ${entries.length}`);
    lines.push(''.padEnd(50, '-'));
    lines.push('');
    
    // Sort entries by published date (newest first)
    const sortedEntries = entries.sort((a, b) => 
      new Date(b.published_date || '').getTime() - new Date(a.published_date || '').getTime()
    );
    
    for (const entry of sortedEntries) {
      lines.push(`ID: ${entry.id}`);
      lines.push(`Title: ${entry.title || 'No title'}`);
      lines.push(`Type: ${entry.type || 'publication'}`);
      lines.push(`Published: ${entry.published_date || 'Unknown date'}`);
      lines.push(`Seen: ${entry.seen ? 'Yes' : 'No'}`);
      
      if (entry.abstract) {
        lines.push(`Abstract: ${entry.abstract}`);
      }
      
      if (entry.body) {
        lines.push(`Body: ${entry.body.substring(0, 500)}${entry.body.length > 500 ? '...' : ''}`);
      }
      
      lines.push('');
    }
    
    lines.push('');
  }
  
  return lines.join('\n');
}

async function uploadToStorage(fileName: string, exportBlob: Blob): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  console.log(`Uploading file: ${fileName}, size: ${exportBlob.size} bytes`);
  
  // Upload to storage bucket
  const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/export-files/${fileName}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: exportBlob,
  });
  
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`, errorText);
    throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
  }
  
  console.log(`File uploaded successfully: ${fileName}`);
  
  // Generate signed URL for download (valid for 7 days)
  const signedUrlResponse = await fetch(`${supabaseUrl}/storage/v1/object/sign/export-files/${fileName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expiresIn: 604800 // 7 days in seconds
    }),
  });
  
  if (!signedUrlResponse.ok) {
    const errorText = await signedUrlResponse.text();
    console.error(`Signed URL generation failed: ${signedUrlResponse.status} ${signedUrlResponse.statusText}`, errorText);
    throw new Error(`Failed to generate signed URL: ${signedUrlResponse.statusText}`);
  }
  
  const signedUrlData = await signedUrlResponse.json();
  const downloadUrl = `${supabaseUrl}/storage/v1${signedUrlData.signedURL}`;
  
  console.log(`Generated download URL: ${downloadUrl}`);
  return downloadUrl;
}

async function updateJobStatus(
  jobId: string,
  status: string,
  progress: any,
  fileName?: string,
  downloadUrl?: string,
  errorMessage?: string
): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  // Determine table name based on environment
  const environment = Deno.env.get('VITE_ENVIRONMENT') || 'development';
  const tableName = environment === 'development' ? 'dev_background_export_jobs' : 'background_export_jobs';
  
  const updateData: any = {
    status,
    progress,
  };
  
  if (fileName) updateData.file_name = fileName;
  if (downloadUrl) updateData.download_url = downloadUrl;
  if (errorMessage) updateData.error_message = errorMessage;
  if (status === 'completed' || status === 'failed') {
    updateData.completed_at = new Date().toISOString();
  }
  
  const response = await fetch(`${supabaseUrl}/rest/v1/${tableName}?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
    },
    body: JSON.stringify(updateData),
  });
  
  if (!response.ok) {
    console.error(`Failed to update job status: ${response.statusText}`);
  }
}

function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}