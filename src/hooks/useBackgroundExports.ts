import { useState, useEffect } from 'react';
import { BackgroundExportJob, BackgroundExportService } from '../services/BackgroundExportService';

export const useBackgroundExports = () => {
  const [activeJobs, setActiveJobs] = useState<BackgroundExportJob[]>([]);
  const [completedJobs, setCompletedJobs] = useState<BackgroundExportJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadJobs();
    
    // Poll for job updates every 5 seconds
    const interval = setInterval(loadJobs, 5000);
    
    // Daily cleanup check (runs once when component mounts)
    checkDailyCleanup();
    
    return () => clearInterval(interval);
  }, []);

  const loadJobs = async () => {
    try {
      const [active, completed] = await Promise.all([
        BackgroundExportService.getActiveJobs(),
        BackgroundExportService.getCompletedJobs()
      ]);
      setActiveJobs(active);
      setCompletedJobs(completed);
    } catch (error) {
      console.error('Failed to load background export jobs:', error);
    }
  };

  const startExport = async (
    type: 'single_site' | 'all_sites' | 'sync',
    sites: any[],
    siteId?: string
  ): Promise<string> => {
    setIsLoading(true);
    try {
      const jobId = await BackgroundExportService.startExport(type, sites, siteId);
      await loadJobs(); // Refresh jobs list
      return jobId;
    } finally {
      setIsLoading(false);
    }
  };

  const cancelJob = async (jobId: string) => {
    try {
      await BackgroundExportService.cancelJob(jobId);
      await loadJobs(); // Refresh jobs list
    } catch (error) {
      console.error('Failed to cancel job:', error);
      throw error;
    }
  };

  const checkDailyCleanup = async () => {
    const lastCleanup = localStorage.getItem('lastBackgroundExportCleanup');
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    if (!lastCleanup || (now - parseInt(lastCleanup)) > oneDayMs) {
      try {
        await BackgroundExportService.cleanupOldJobs();
        localStorage.setItem('lastBackgroundExportCleanup', now.toString());
        console.log('Daily cleanup completed');
      } catch (error) {
        console.error('Daily cleanup failed:', error);
      }
    }
  };

  return {
    activeJobs,
    completedJobs,
    isLoading,
    startExport,
    cancelJob,
    refreshJobs: loadJobs
  };
};