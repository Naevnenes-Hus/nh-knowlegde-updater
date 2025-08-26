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
        
      case 'sync':
        ({ fileName, zipBlob } = await processSyncExport(job.jobId, job.sites));
        break;
        
      default:
        throw new Error(`Unknown export type: ${job.type}`);
    }

    // Upload to Supabase Storage
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
  // This is a simplified version - in reality, you'd need to:
  // 1. Connect to your database
  // 2. Load entries for the site
  // 3. Create ZIP with date-based folders
  // 4. Update progress throughout
  
  await updateJobStatus(jobId, 'processing', {
    current: 25,
    total: 100,
    step: 'loading-entries',
    currentSite: site.name
  });
  
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await updateJobStatus(jobId, 'processing', {
    current: 75,
    total: 100,
    step: 'creating-zip',
    currentSite: site.name
  });
  
  // Create a simple ZIP (in reality, you'd use JSZip and actual data)
  const zipContent = `Export for ${site.name}\nGenerated at: ${new Date().toISOString()}`;
  const zipBlob = new Blob([zipContent], { type: 'application/zip' });
  
  const timestamp = new Date().toISOString().split('T')[0];
  const fileName = `${sanitizeFileName(site.name)}_entries_${timestamp}.zip`;
  
  return { fileName, zipBlob };
}

async function processAllSitesExport(jobId: string, sites: Site[]): Promise<{ fileName: string; zipBlob: Blob }> {
  let processed = 0;
  
  for (const site of sites) {
    await updateJobStatus(jobId, 'processing', {
      current: processed,
      total: sites.length,
      step: 'processing-site',
      currentSite: site.name
    });
    
    // Simulate processing each site
    await new Promise(resolve => setTimeout(resolve, 1000));
    processed++;
  }
  
  await updateJobStatus(jobId, 'processing', {
    current: sites.length,
    total: sites.length,
    step: 'creating-zip',
    currentSite: ''
  });
  
  const zipContent = `Export for all ${sites.length} sites\nGenerated at: ${new Date().toISOString()}`;
  const zipBlob = new Blob([zipContent], { type: 'application/zip' });
  
  const timestamp = new Date().toISOString().split('T')[0];
  const fileName = `all_sites_export_${timestamp}.zip`;
  
  return { fileName, zipBlob };
}

async function processSyncExport(jobId: string, sites: Site[]): Promise<{ fileName: string; zipBlob: Blob }> {
  let processed = 0;
  
  for (const site of sites) {
    await updateJobStatus(jobId, 'processing', {
      current: processed,
      total: sites.length,
      step: 'syncing-site',
      currentSite: site.name
    });
    
    // Simulate sync processing
    await new Promise(resolve => setTimeout(resolve, 1500));
    processed++;
  }
  
  const zipContent = `Sync export for ${sites.length} sites\nGenerated at: ${new Date().toISOString()}`;
  const zipBlob = new Blob([zipContent], { type: 'application/zip' });
  
  const timestamp = new Date().toISOString().split('T')[0];
  const fileName = `knowledge_sync_${timestamp}.zip`;
  
  return { fileName, zipBlob };
}

async function uploadToStorage(fileName: string, zipBlob: Blob): Promise<string> {
  // Get Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  // Upload to storage bucket
  const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/export-files/${fileName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/zip',
    },
    body: zipBlob,
  });
  
  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload file: ${uploadResponse.statusText}`);
  }
  
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
    throw new Error(`Failed to generate signed URL: ${signedUrlResponse.statusText}`);
  }
  
  const signedUrlData = await signedUrlResponse.json();
  return `${supabaseUrl}/storage/v1${signedUrlData.signedURL}`;
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