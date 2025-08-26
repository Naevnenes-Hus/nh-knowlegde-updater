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

// Import JSZip for creating ZIP files
import JSZip from "npm:jszip@3.10.1";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Force redeploy - updated timestamp with ZIP support
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
    let zipBlob: Blob;
    
    switch (job.type) {
      case 'single_site':
        if (!job.siteId) {
          throw new Error('Site ID required for single site export');
        }
        const site = job.sites.find(s => s.id === job.siteId);
        if (!site) {
          throw new Error('Site not found');
        }
        ({ fileName, zipBlob } = await processSingleSiteExport(job.jobId, site));
        break;
        
      case 'all_sites':
        ({ fileName, zipBlob } = await processAllSitesExport(job.jobId, job.sites));
        break;

      default:
        throw new Error(`Unknown export type: ${job.type}`);
    }

    // Upload ZIP to Supabase Storage
    const downloadUrl = await uploadToStorage(fileName, zipBlob);
    
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

async function processSingleSiteExport(jobId: string, site: Site): Promise<{ fileName: string; zipBlob: Blob }> {
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
    step: 'creating-zip',
    currentSite: site.name
  });
  
  // Create ZIP file
  const zip = new JSZip();
  const siteFolderName = sanitizeFileName(site.name);
  const siteFolder = zip.folder(siteFolderName);
  
  if (siteFolder) {
    // Sort entries by published date (newest first)
    entries.sort((a, b) => new Date(b.published_date || '').getTime() - new Date(a.published_date || '').getTime());
    
    // Add all entries to the site folder using GUID as filename
    entries.forEach((entry) => {
      const fileName = `${sanitizeFileName(entry.id)}.txt`;
      const content = formatEntryContent(entry);
      siteFolder.file(fileName, content);
    });
    
    // Add site info file
    const siteInfo = formatSiteInfo(site, entries.length);
    siteFolder.file('_site_info.txt', siteInfo);
  }
  
  await updateJobStatus(jobId, 'processing', {
    current: 90,
    total: 100,
    step: 'generating-zip',
    currentSite: site.name
  });
  
  // Generate ZIP blob
  const zipBlob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'STORE' // No compression for maximum compatibility
  });
  
  const timestamp = new Date().toISOString().split('T')[0];
  const fileName = `${sanitizeFileName(site.name)}_entries_${timestamp}.zip`;
  
  console.log(`Generated ZIP file: ${fileName}, size: ${zipBlob.size} bytes`);
  
  return { fileName, zipBlob };
}

async function processAllSitesExport(jobId: string, sites: Site[]): Promise<{ fileName: string; zipBlob: Blob }> {
  console.log(`Processing all sites export for ${sites.length} sites`);
  
  const zip = new JSZip();
  let totalEntries = 0;
  
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
      
      if (entries.length > 0) {
        // Create a folder for each site
        const siteFolderName = sanitizeFileName(site.name);
        const siteFolder = zip.folder(siteFolderName);
        
        if (siteFolder) {
          // Sort entries by published date (newest first)
          entries.sort((a, b) => new Date(b.published_date || '').getTime() - new Date(a.published_date || '').getTime());
          
          // Group entries by publication date and create date folders
          const entriesByDate = groupEntriesByDate(entries);
          
          // Create a folder for each date
          for (const [dateFolder, dateEntries] of Object.entries(entriesByDate)) {
            const dateFolderInSite = siteFolder.folder(dateFolder);
            
            if (dateFolderInSite) {
              dateEntries.forEach((entry) => {
                const fileName = `${sanitizeFileName(entry.id)}.txt`;
                const content = formatEntryContent(entry);
                dateFolderInSite.file(fileName, content);
                totalEntries++;
              });
            }
          }
            
            if (dateFolderInSite) {
              dateEntries.forEach((entry) => {
                const fileName = `${sanitizeFileName(entry.id)}.txt`;
                const content = formatEntryContent(entry);
                dateFolderInSite.file(fileName, content);
              });
            }
          }
          
          // Add site info file
          const siteInfo = formatSiteInfo(site, entries.length);
          siteFolder.file('_site_info.txt', siteInfo);
        }
      }
    } catch (error) {
      console.error(`Failed to load entries for ${site.name}:`, error);
      // Continue with other sites
    }
  }
  
  await updateJobStatus(jobId, 'processing', {
    current: 85,
    total: 100,
    step: 'creating-zip',
    currentSite: ''
  });
  
  // Add summary file at root level
  const summaryContent = formatSummary(sites, totalEntries);
  zip.file('_export_summary.txt', summaryContent);
  
  await updateJobStatus(jobId, 'processing', {
    current: 95,
    total: 100,
    step: 'generating-zip',
    currentSite: ''
  });
  
  // Generate ZIP blob
  const zipBlob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'STORE' // No compression for maximum compatibility
  });
  
  const timestamp = new Date().toISOString().split('T')[0];
  const fileName = `all_sites_export_${timestamp}.zip`;
  
  console.log(`Generated ZIP file: ${fileName}, size: ${zipBlob.size} bytes`);
  
  return { fileName, zipBlob };
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

function formatEntryContent(entry: Entry): string {
  // Extract values from entry and metadata
  const metadata = entry.metadata || {};
  
  const content = [
    `id: ${entry.id || ''}`,
    `type: ${entry.type || ''}`,
    `jnr: ${metadata.jnr || ''}`,
    `title: ${entry.title || ''}`,
    `published_date: ${entry.published_date || ''}`,
    `date: ${metadata.date || entry.published_date || ''}`,
    `is_board_ruling: ${metadata.is_board_ruling || ''}`,
    `is_brought_to_court: ${metadata.is_brought_to_court || ''}`,
    `authority: ${metadata.authority || ''}`,
    `categories: ${Array.isArray(metadata.categories) ? metadata.categories.join(', ') : metadata.categories || ''}`,
    `seen: ${entry.seen ? 'true' : 'false'}`,
    `site_url: ${entry.site_url || ''}`,
    `abstract: ${entry.abstract || ''}`,
    `body: ${entry.body || ''}`
  ].join('\n');

  return content;
}

function formatSiteInfo(site: Site, totalEntries: number): string {
  return [
    `Site Information`,
    `================`,
    ``,
    `Name: ${site.name}`,
    `URL: ${site.url}`,
    `Total Entries: ${totalEntries}`,
    ``,
    `Export Date: ${new Date().toLocaleString()}`,
    ``,
    `File Structure:`,
    `- All entries are in this folder (files named by GUID)`,
    `- Each file contains the full entry data in structured format`
  ].join('\n');
}

function formatSummary(sites: Site[], totalEntries: number): string {
  const siteList = sites.map(site => `- ${site.name} (${site.url})`).join('\n');
  
  return [
    `Knowledge Export Summary`,
    `=======================`,
    ``,
    `Export Date: ${new Date().toLocaleString()}`,
    `Total Sites: ${sites.length}`,
    `Total Entries: ${totalEntries}`,
    ``,
    `Sites Included:`,
    siteList,
    ``,
    `ZIP Structure:`,
    `- Each site has its own folder named after the site`,
    `- All entries for each site are in the site folder (files named by GUID)`,
    `- Site information is in '_site_info.txt' in each site folder`,
    `- This summary is in '_export_summary.txt' at the root`,
    ``,
    `File Naming:`,
    `- All entry files are named using their GUID (e.g., 'abc123def456.txt')`,
    `- Each file contains the full entry data in structured format`
  ].join('\n');
}

async function uploadToStorage(fileName: string, zipBlob: Blob): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  console.log(`Uploading ZIP file: ${fileName}, size: ${zipBlob.size} bytes`);
  
  // Upload to storage bucket
  const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/export-files/${fileName}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/zip',
    },
    body: zipBlob,
  });
  
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`, errorText);
    throw new Error(`Failed to upload ZIP file: ${uploadResponse.statusText}`);
  }
  
  console.log(`ZIP file uploaded successfully: ${fileName}`);
  
  // Generate public download URL directly
  const downloadUrl = `${supabaseUrl}/storage/v1/object/public/export-files/${fileName}`;
  
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

/**
 * Group entries by their publication date
 */
function groupEntriesByDate(entries: Entry[]): { [dateFolder: string]: Entry[] } {
  const groups: { [dateFolder: string]: Entry[] } = {};
  
  entries.forEach(entry => {
    let dateFolder = 'unknown-date';
    
    if (entry.published_date) {
      try {
        const date = new Date(entry.published_date);
        if (!isNaN(date.getTime())) {
          // Format as YYYY-MM-DD
          dateFolder = date.toISOString().split('T')[0];
        }
      } catch (error) {
        console.warn(`Invalid date format for entry ${entry.id}: ${entry.published_date}`);
      }
    }
    
    if (!groups[dateFolder]) {
      groups[dateFolder] = [];
    }
    groups[dateFolder].push(entry);
  });
  
  return groups;
}