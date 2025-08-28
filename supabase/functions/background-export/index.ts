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
    let job: ExportJob;
    try {
      job = await req.json();
      
      // Validate required fields
      if (!job || typeof job.jobId !== 'string' || typeof job.type !== 'string' || !Array.isArray(job.sites)) {
        throw new Error('Invalid job payload structure');
      }
    } catch (jsonError) {
      console.error("Error parsing request body:", jsonError);
      return new Response(
        JSON.stringify({ error: `Invalid request body: ${jsonError.message}` }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }
    
    console.log(`Starting background export job: ${job.jobId} (${job.type})`);
    
    // Update job status to processing
    await updateJobStatus(job.jobId, 'processing', {
      current: 0,
      total: 100,
      step: 'initializing',
      currentSite: ''
    });

    // Process the export based on type with memory-efficient streaming
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
        ({ fileName, zipBlob } = await processSingleSiteExportStreaming(job.jobId, site));
        break;
        
      case 'all_sites':
        ({ fileName, zipBlob } = await processAllSitesExportStreaming(job.jobId, job.sites));
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

async function processSingleSiteExportStreaming(jobId: string, site: Site): Promise<{ fileName: string; zipBlob: Blob }> {
  console.log(`Processing single site export for: ${site.name}`);
  
  // First, get the actual total count of entries for this site
  const actualTotal = await getEntryCount(site);
  console.log(`Site ${site.name} has ${actualTotal} total entries`);
  
  await updateJobStatus(jobId, 'processing', {
    current: 10,
    total: actualTotal,
    step: 'loading-entries',
    currentSite: site.name
  });
  
  // Create ZIP with streaming approach
  const zip = new JSZip();
  const siteFolderName = sanitizeFileName(site.name);
  const siteFolder = zip.folder(siteFolderName);
  
  if (!siteFolder) {
    throw new Error('Failed to create site folder in ZIP');
  }
  
  // Load and process entries in small chunks to avoid memory issues
  let totalProcessed = 0;
  const chunkSize = 10; // Small chunks to minimize CPU usage per iteration
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    console.log(`Loading chunk starting at offset ${offset}`);
    
    const entries = await loadEntriesChunk(site, chunkSize, offset);
    
    if (entries.length === 0) {
      hasMore = false;
      break;
    }
    
    // Process this chunk
    entries.forEach((entry) => {
      // Get publication date for folder organization
      const dateFolder = getDateFolder(entry.published_date);
      
      // Create or get the date folder within the site folder
      let dateFolderInSite = siteFolder.folder(dateFolder);
      if (!dateFolderInSite) {
        dateFolderInSite = siteFolder.folder(dateFolder);
      }
      
      if (dateFolderInSite) {
        const fileName = `${sanitizeFileName(entry.id)}.txt`;
        const content = formatEntryContent(entry);
        dateFolderInSite.file(fileName, content);
        totalProcessed++;
      }
    });
    
    console.log(`Processed chunk: ${entries.length} entries (total: ${totalProcessed})`);
    
    // Update progress
    await updateJobStatus(jobId, 'processing', {
      current: totalProcessed,
      total: actualTotal,
      step: 'creating-zip',
      currentSite: site.name
    });
    
    // If we got fewer entries than requested, we've reached the end
    if (entries.length < chunkSize) {
      hasMore = false;
    } else {
      offset += entries.length;
    }
    
    // Small delay to prevent memory buildup
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Add site info file
  const siteInfo = formatSiteInfo(site, totalProcessed);
  siteFolder.file('_site_info.txt', siteInfo);
  
  await updateJobStatus(jobId, 'processing', {
    current: totalProcessed,
    total: actualTotal,
    step: 'generating-zip',
    currentSite: site.name
  });
  
  // Generate ZIP blob with minimal compression to save memory
  const zipBlob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'STORE', // No compression to save memory
    streamFiles: true // Enable streaming for large files
  });
  
  const timestamp = new Date().toISOString().split('T')[0];
  const fileName = `${sanitizeFileName(site.name)}_entries_${timestamp}.zip`;
  
  console.log(`Generated ZIP file: ${fileName}, size: ${zipBlob.size} bytes`);
  
  return { fileName, zipBlob };
}

async function getEntryCount(site: Site): Promise<number> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  // Determine table names based on environment
  const environment = Deno.env.get('VITE_ENVIRONMENT') || 'development';
  const entriesTable = environment === 'development' ? 'dev_entries' : 'entries';
  
  try {
    const countResponse = await fetch(
      `${supabaseUrl}/rest/v1/${entriesTable}?site_id=eq.${site.id}&select=count`,
      {
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Prefer': 'count=exact'
        },
      }
    );
    
    if (!countResponse.ok) {
      console.warn(`Failed to get entry count, using fallback: ${countResponse.statusText}`);
      return 1000; // Fallback estimate
    }
    
    const countHeader = countResponse.headers.get('content-range');
    if (countHeader) {
      const match = countHeader.match(/\/(\d+)$/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    
    return 1000; // Fallback estimate
  } catch (error) {
    console.warn('Error getting entry count:', error);
    return 1000; // Fallback estimate
  }
}
async function processAllSitesExportStreaming(jobId: string, sites: Site[]): Promise<{ fileName: string; zipBlob: Blob }> {
  console.log(`Processing all sites export for ${sites.length} sites`);
  
  const zip = new JSZip();
  let totalEntries = 0;
  
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    
    await updateJobStatus(jobId, 'processing', {
      current: i,
      total: sites.length,
      step: 'loading-entries',
      currentSite: site.name
    });
    
    try {
      // Create a folder for each site
      const siteFolderName = sanitizeFileName(site.name);
      const siteFolder = zip.folder(siteFolderName);
      
      if (!siteFolder) {
        console.error(`Failed to create folder for site: ${site.name}`);
        continue;
      }
      
      // Load entries in small chunks for this site
      let siteEntryCount = 0;
      const chunkSize = 10; // Small chunks to minimize CPU usage per iteration
      let offset = 0;
      let hasMore = true;
      
      while (hasMore) {
        const entries = await loadEntriesChunk(site, chunkSize, offset);
        
        if (entries.length === 0) {
          hasMore = false;
          break;
        }
        
        // Process this chunk
        entries.forEach((entry) => {
          const fileName = `${sanitizeFileName(entry.id)}.txt`;
          const content = formatEntryContent(entry);
          siteFolder.file(fileName, content);
          siteEntryCount++;
          totalEntries++;
        });
        
        console.log(`Site ${site.name}: processed ${entries.length} entries (site total: ${siteEntryCount})`);
        
        // If we got fewer entries than requested, we've reached the end
        if (entries.length < chunkSize) {
          hasMore = false;
        } else {
          offset += entries.length;
        }
        
        // Longer delay between chunks for all-sites export
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Add site info file
      if (siteEntryCount > 0) {
        const siteInfo = formatSiteInfo(site, siteEntryCount);
        siteFolder.file('_site_info.txt', siteInfo);
      }
      
      console.log(`Completed site ${site.name}: ${siteEntryCount} entries`);
      
    } catch (error) {
      console.error(`Failed to process site ${site.name}:`, error);
      // Continue with other sites instead of failing completely
    }
    
    // Delay between sites to prevent memory buildup
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  await updateJobStatus(jobId, 'processing', {
    current: sites.length,
    total: sites.length,
    step: 'creating-summary',
    currentSite: ''
  });
  
  // Add summary file at root level
  const summaryContent = formatSummary(sites, totalEntries);
  zip.file('_export_summary.txt', summaryContent);
  
  await updateJobStatus(jobId, 'processing', {
    current: totalEntries,
    total: totalEntries,
    step: 'generating-zip',
    currentSite: ''
  });
  
  // Generate ZIP blob with minimal compression
  const zipBlob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'STORE', // No compression to save memory
    streamFiles: true // Enable streaming for large files
  });
  
  const timestamp = new Date().toISOString().split('T')[0];
  const fileName = `all_sites_export_${timestamp}.zip`;
  
  console.log(`Generated ZIP file: ${fileName}, size: ${zipBlob.size} bytes`);
  
  return { fileName, zipBlob };
}

async function loadEntriesChunk(site: Site, limit: number, offset: number): Promise<Entry[]> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  // Determine table names based on environment
  const environment = Deno.env.get('VITE_ENVIRONMENT') || 'development';
  const entriesTable = environment === 'development' ? 'dev_entries' : 'entries';
  
  // Load entries chunk with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
  
  try {
    const entriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/${entriesTable}?site_id=eq.${site.id}&order=published_date.desc&limit=${limit}&offset=${offset}`,
      {
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
        },
        signal: controller.signal,
      }
    );
    
    clearTimeout(timeoutId);
    
    if (!entriesResponse.ok) {
      throw new Error(`Failed to fetch entries: ${entriesResponse.statusText}`);
    }
    
    const entries = await entriesResponse.json();
    return entries || [];
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Entries fetch timeout');
    }
    throw error;
  }
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
  
  // First, ensure the bucket exists and is public
  try {
    const bucketResponse = await fetch(`${supabaseUrl}/storage/v1/bucket/export-files`, {
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
    });
    
    if (!bucketResponse.ok && bucketResponse.status === 404) {
      // Create bucket if it doesn't exist
      console.log('Creating export-files bucket...');
      const createBucketResponse = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: 'export-files',
          name: 'export-files',
          public: true
        }),
      });
      
      if (!createBucketResponse.ok) {
        const errorText = await createBucketResponse.text();
        console.error(`Failed to create bucket: ${createBucketResponse.status}`, errorText);
      } else {
        console.log('Export-files bucket created successfully');
      }
    }
  } catch (bucketError) {
    console.warn('Could not check/create bucket:', bucketError);
  }
  
  // Upload to storage bucket with retry logic
  let uploadSuccess = false;
  let uploadError: Error | null = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Upload attempt ${attempt}/3...`);
      
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
        throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`);
      }
      
      uploadSuccess = true;
      console.log(`ZIP file uploaded successfully on attempt ${attempt}: ${fileName}`);
      break;
      
    } catch (error) {
      uploadError = error as Error;
      console.error(`Upload attempt ${attempt} failed:`, error);
      
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
      }
    }
  }
  
  if (!uploadSuccess) {
    throw new Error(`Failed to upload after 3 attempts: ${uploadError?.message}`);
  }
  
  // Generate public download URL
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
  
  try {
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
  } catch (error) {
    console.error('Error updating job status:', error);
  }
}

function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

function getDateFolder(publishedDate: string): string {
  if (!publishedDate) {
    return 'unknown-date';
  }
  
  try {
    const date = new Date(publishedDate);
    if (isNaN(date.getTime())) {
      return 'unknown-date';
    }
    
    // Format as YYYY-MM-DD for folder name
    return date.toISOString().split('T')[0];
  } catch (error) {
    console.warn(`Invalid date format: ${publishedDate}`);
    return 'unknown-date';
  }
}