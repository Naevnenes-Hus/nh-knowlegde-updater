const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    console.log('Starting daily cleanup...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Determine table name based on environment
    const environment = Deno.env.get('VITE_ENVIRONMENT') || 'development';
    const tableName = environment === 'development' ? 'dev_background_export_jobs' : 'background_export_jobs';
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Get old jobs with file names
    const fetchResponse = await fetch(`${supabaseUrl}/rest/v1/${tableName}?created_at=lt.${sevenDaysAgo.toISOString()}&select=id,file_name`, {
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseServiceKey,
      },
    });
    
    if (!fetchResponse.ok) {
      throw new Error(`Failed to fetch old jobs: ${fetchResponse.statusText}`);
    }
    
    const oldJobs = await fetchResponse.json();
    console.log(`Found ${oldJobs.length} old jobs to clean up`);
    
    if (oldJobs.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No old jobs to clean up' }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }
    
    // Delete files from storage
    const filesToDelete = oldJobs
      .filter((job: any) => job.file_name)
      .map((job: any) => job.file_name);
    
    if (filesToDelete.length > 0) {
      const deleteFilesResponse = await fetch(`${supabaseUrl}/storage/v1/object/export-files`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prefixes: filesToDelete
        }),
      });
      
      if (!deleteFilesResponse.ok) {
        console.error(`Failed to delete files: ${deleteFilesResponse.statusText}`);
      } else {
        console.log(`Deleted ${filesToDelete.length} files from storage`);
      }
    }
    
    // Delete job records
    const deleteJobsResponse = await fetch(`${supabaseUrl}/rest/v1/${tableName}?created_at=lt.${sevenDaysAgo.toISOString()}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseServiceKey,
      },
    });
    
    if (!deleteJobsResponse.ok) {
      throw new Error(`Failed to delete job records: ${deleteJobsResponse.statusText}`);
    }
    
    console.log(`Deleted ${oldJobs.length} old job records`);
    
    return new Response(
      JSON.stringify({ 
        message: 'Cleanup completed successfully',
        deletedJobs: oldJobs.length,
        deletedFiles: filesToDelete.length
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
    
  } catch (error) {
    console.error("Daily cleanup error:", error);
    
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