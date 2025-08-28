import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Site {
  id: string;
  url: string;
  name: string;
}

interface JobRequest {
  jobId: string;
  type: 'single_site' | 'all_sites';
  sites: Site[];
  siteId?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let jobId: string;
  let type: 'single_site' | 'all_sites';
  let sites: Site[];
  let siteId: string | undefined;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const requestBody: JobRequest = await req.json();
    jobId = requestBody.jobId;
    type = requestBody.type;
    sites = requestBody.sites;
    siteId = requestBody.siteId;

    // Update job status to processing
    await updateJobStatus(supabase, jobId, 'processing', {
      current: 0,
      total: 0,
      step: 'starting',
      currentSite: ''
    });

    // Process sites with memory-efficient streaming
    const sitesToProcess = type === 'single_site' && siteId 
      ? sites.filter(s => s.id === siteId)
      : sites;

    let totalProcessed = 0;
    const results: string[] = [];

    for (const site of sitesToProcess) {
      await updateJobStatus(supabase, jobId, 'processing', {
        current: totalProcessed,
        total: 0,
        step: 'processing-site',
        currentSite: site.name
      });

      // Process site in small chunks to avoid memory issues
      const siteResult = await processSiteStreaming(supabase, site, jobId);
      results.push(siteResult);
      totalProcessed++;
    }

    // Create final export content
    const exportContent = results.join('\n\n' + '='.repeat(80) + '\n\n');
    
    // Upload to storage
    const fileName = `export_${jobId}.txt`;
    const { error: uploadError } = await supabase.storage
      .from('export-files')
      .upload(fileName, new Blob([exportContent], { type: 'text/plain' }));

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // Get download URL
    const { data: urlData } = await supabase.storage
      .from('export-files')
      .createSignedUrl(fileName, 604800); // 7 days

    // Mark job as completed
    const tableName = getTableName();
    await supabase
      .from(tableName)
      .update({
        status: 'completed',
        file_name: fileName,
        download_url: urlData?.signedUrl,
        completed_at: new Date().toISOString(),
        progress: {
          current: totalProcessed,
          total: totalProcessed,
          step: 'completed',
          currentSite: ''
        }
      })
      .eq('id', jobId);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Background export error:', error);
    
    // Try to mark job as failed
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      const tableName = getTableName();
      
      await supabase
        .from(tableName)
        .update({
          status: 'failed',
          error_message: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);
    } catch (updateError) {
      console.error('Failed to update job status:', updateError);
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function processSiteStreaming(supabase: any, site: Site, jobId: string): Promise<string> {
  const entriesTableName = getEntriesTableName();
  let allFolders: string[] = [];
  let offset = 0;
  const chunkSize = 50; // Larger chunks for better performance
  const itemsPerFolder = 500; // 500 items per page/folder
  let hasMore = true;
  let processed = 0;
  let currentFolderEntries: string[] = [];
  let currentFolderNumber = 1;

  while (hasMore) {
    // Get small chunk of entries
    const { data: entries, error } = await supabase
      .from(entriesTableName)
      .select('title, abstract, body, published_date, type')
      .eq('site_id', site.id)
      .range(offset, offset + chunkSize - 1)
      .order('published_date', { ascending: true }); // Oldest first for proper paging

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    if (!entries || entries.length === 0) {
      hasMore = false;
      break;
    }

    // Process entries immediately to avoid memory buildup
    for (const entry of entries) {
      const entryText = formatEntry(entry);
      currentFolderEntries.push(entryText);
      processed++;

      // When we reach 500 items, create a folder and reset
      if (currentFolderEntries.length >= itemsPerFolder) {
        const folderName = `page_${currentFolderNumber.toString().padStart(3, '0')}`;
        const folderContent = `FOLDER: ${folderName}\nITEMS: ${currentFolderEntries.length}\n\n` + 
                             currentFolderEntries.join('\n\n---\n\n');
        allFolders.push(folderContent);
        
        currentFolderEntries = [];
        currentFolderNumber++;
      }

      // Update progress every 50 entries
      if (processed % 50 === 0) {
        await updateJobStatus(supabase, jobId, 'processing', {
          current: processed,
          total: 0,
          step: 'processing-entries',
          currentSite: site.name
        });
      }
    }

    offset += chunkSize;
    
    // If we got fewer entries than requested, we're done
    if (entries.length < chunkSize) {
      hasMore = false;
    }
  }

  // Handle remaining entries in the last folder
  if (currentFolderEntries.length > 0) {
    const folderName = `page_${currentFolderNumber.toString().padStart(3, '0')}`;
    const folderContent = `FOLDER: ${folderName}\nITEMS: ${currentFolderEntries.length}\n\n` + 
                         currentFolderEntries.join('\n\n---\n\n');
    allFolders.push(folderContent);
  }

  // Format site section
  const siteHeader = `SITE: ${site.name}\nURL: ${site.url}\nENTRIES: ${processed}\n\n`;
  return siteHeader + allFolders.join('\n\n' + '='.repeat(50) + '\n\n');
}

function formatEntry(entry: any): string {
  const parts = [];
  
  if (entry.title) parts.push(`TITLE: ${entry.title}`);
  if (entry.published_date) parts.push(`DATE: ${entry.published_date}`);
  if (entry.type) parts.push(`TYPE: ${entry.type}`);
  if (entry.abstract) parts.push(`ABSTRACT: ${entry.abstract}`);
  if (entry.body) parts.push(`CONTENT: ${entry.body}`);
  
  return parts.join('\n');
}

async function updateJobStatus(supabase: any, jobId: string, status: string, progress: any) {
  const tableName = getTableName();
  await supabase
    .from(tableName)
    .update({ status, progress })
    .eq('id', jobId);
}

function getTableName(): string {
  return 'background_export_jobs';
}

function getEntriesTableName(): string {
  return 'entries';
}