import { StorageService } from './StorageService';
import { ExportService } from './ExportService';
import { Site } from '../types';
import { DatabaseService } from './DatabaseService';

export interface BackgroundExportJob {
  id: string;
  type: 'single_site' | 'all_sites' | 'sync';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: {
    current: number;
    total: number;
    step: string;
    currentSite: string;
  };
  siteId?: string;
  siteName?: string;
  fileName?: string;
  downloadUrl?: string;
  errorMessage?: string;
  createdAt: number;
  completedAt?: number;
  estimatedSize?: number;
}

export class BackgroundExportService {
  private static readonly STORAGE_BUCKET = 'export-files';
  private static readonly TABLE_NAME = 'background_export_jobs';
  
  /**
   * Start a background export job
   */
  static async startExport(
    type: 'single_site' | 'all_sites' | 'sync',
    sites: Site[],
    siteId?: string
  ): Promise<string> {
    const db = DatabaseService.getInstance();
    const supabase = db.getSupabaseClient();
    
    if (!supabase) {
      throw new Error('Database not available for background processing');
    }

    const jobId = `export_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const siteName = siteId ? sites.find(s => s.id === siteId)?.name : 'All Sites';
    
    // Estimate total entries for progress tracking
    let totalEntries = 0;
    if (type === 'single_site' && siteId) {
      const site = sites.find(s => s.id === siteId);
      if (site) {
        totalEntries = await StorageService.getActualEntryCount(site.url);
      }
    } else {
      for (const site of sites) {
        try {
          totalEntries += await StorageService.getActualEntryCount(site.url);
        } catch (error) {
          console.warn(`Failed to get entry count for ${site.name}:`, error);
        }
      }
    }

    const job: BackgroundExportJob = {
      id: jobId,
      type,
      status: 'queued',
      progress: {
        current: 0,
        total: totalEntries,
        step: 'initializing',
        currentSite: ''
      },
      siteId,
      siteName,
      createdAt: Date.now(),
      estimatedSize: totalEntries * 2000 // Rough estimate: 2KB per entry
    };

    // Save job to database
    const { error } = await supabase
      .from(this.getTableName())
      .insert({
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        site_id: job.siteId,
        site_name: job.siteName,
        created_at: new Date(job.createdAt).toISOString(),
        estimated_size: job.estimatedSize
      });

    if (error) {
      throw new Error(`Failed to create background job: ${error.message}`);
    }

    // Start processing in the background using Edge Function
    this.triggerBackgroundProcessing(jobId, type, sites, siteId);

    return jobId;
  }

  /**
   * Get job status
   */
  static async getJobStatus(jobId: string): Promise<BackgroundExportJob | null> {
    const db = DatabaseService.getInstance();
    const supabase = db.getSupabaseClient();
    
    if (!supabase) {
      return null;
    }

    const { data, error } = await supabase
      .from(this.getTableName())
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      type: data.type,
      status: data.status,
      progress: data.progress || { current: 0, total: 0, step: '', currentSite: '' },
      siteId: data.site_id,
      siteName: data.site_name,
      fileName: data.file_name,
      downloadUrl: data.download_url,
      errorMessage: data.error_message,
      createdAt: new Date(data.created_at).getTime(),
      completedAt: data.completed_at ? new Date(data.completed_at).getTime() : undefined,
      estimatedSize: data.estimated_size
    };
  }

  /**
   * Get all active jobs for the user
   */
  static async getActiveJobs(): Promise<BackgroundExportJob[]> {
    const db = DatabaseService.getInstance();
    const supabase = db.getSupabaseClient();
    
    if (!supabase) {
      return [];
    }

    const { data, error } = await supabase
      .from(this.getTableName())
      .select('*')
      .in('status', ['queued', 'processing'])
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map(row => ({
      id: row.id,
      type: row.type,
      status: row.status,
      progress: row.progress || { current: 0, total: 0, step: '', currentSite: '' },
      siteId: row.site_id,
      siteName: row.site_name,
      fileName: row.file_name,
      downloadUrl: row.download_url,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at).getTime(),
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined,
      estimatedSize: row.estimated_size
    }));
  }

  /**
   * Get completed jobs (last 7 days)
   */
  static async getCompletedJobs(): Promise<BackgroundExportJob[]> {
    const db = DatabaseService.getInstance();
    const supabase = db.getSupabaseClient();
    
    if (!supabase) {
      return [];
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
      .from(this.getTableName())
      .select('*')
      .eq('status', 'completed')
      .gte('completed_at', sevenDaysAgo.toISOString())
      .order('completed_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map(row => ({
      id: row.id,
      type: row.type,
      status: row.status,
      progress: row.progress || { current: 0, total: 0, step: '', currentSite: '' },
      siteId: row.site_id,
      siteName: row.site_name,
      fileName: row.file_name,
      downloadUrl: row.download_url,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at).getTime(),
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined,
      estimatedSize: row.estimated_size
    }));
  }

  /**
   * Cancel a background job
   */
  static async cancelJob(jobId: string): Promise<void> {
    const db = DatabaseService.getInstance();
    const supabase = db.getSupabaseClient();
    
    if (!supabase) {
      throw new Error('Database not available');
    }

    const { error } = await supabase
      .from(this.getTableName())
      .update({
        status: 'failed',
        error_message: 'Cancelled by user',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);

    if (error) {
      throw new Error(`Failed to cancel job: ${error.message}`);
    }
  }

  /**
   * Trigger background processing via Edge Function
   */
  private static async triggerBackgroundProcessing(
    jobId: string,
    type: string,
    sites: Site[],
    siteId?: string
  ): Promise<void> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/background-export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          jobId,
          type,
          sites: sites.map(site => ({
            id: site.id,
            url: site.url,
            name: site.name
          })),
          siteId
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to trigger background processing: ${response.statusText}`);
      }

      console.log(`Background export job ${jobId} triggered successfully`);
    } catch (error) {
      console.error('Failed to trigger background processing:', error);
      
      // Mark job as failed if we can't trigger it
      const db = DatabaseService.getInstance();
      const supabase = db.getSupabaseClient();
      
      if (supabase) {
        await supabase
          .from(this.getTableName())
          .update({
            status: 'failed',
            error_message: `Failed to start processing: ${error.message}`,
            completed_at: new Date().toISOString()
          })
          .eq('id', jobId);
      }
      
      throw error;
    }
  }

  /**
   * Clean up old jobs and files (called daily)
   */
  static async cleanupOldJobs(): Promise<void> {
    const db = DatabaseService.getInstance();
    const supabase = db.getSupabaseClient();
    
    if (!supabase) {
      return;
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    try {
      // Get old jobs with file URLs
      const { data: oldJobs, error: fetchError } = await supabase
        .from(this.getTableName())
        .select('id, file_name')
        .lt('created_at', sevenDaysAgo.toISOString());

      if (fetchError) {
        console.error('Failed to fetch old jobs for cleanup:', fetchError);
        return;
      }

      // Delete files from storage
      if (oldJobs && oldJobs.length > 0) {
        const filesToDelete = oldJobs
          .filter(job => job.file_name)
          .map(job => job.file_name);

        if (filesToDelete.length > 0) {
          const { error: storageError } = await supabase.storage
            .from(this.STORAGE_BUCKET)
            .remove(filesToDelete);

          if (storageError) {
            console.error('Failed to delete old files from storage:', storageError);
          } else {
            console.log(`Deleted ${filesToDelete.length} old files from storage`);
          }
        }

        // Delete job records
        const { error: deleteError } = await supabase
          .from(this.getTableName())
          .delete()
          .lt('created_at', sevenDaysAgo.toISOString());

        if (deleteError) {
          console.error('Failed to delete old job records:', deleteError);
        } else {
          console.log(`Deleted ${oldJobs.length} old job records`);
        }
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  private static getTableName(): string {
    const environment = import.meta.env.VITE_ENVIRONMENT || 'development';
    const prefix = environment === 'development' ? 'dev_' : '';
    return `${prefix}${this.TABLE_NAME}`;
  }
}