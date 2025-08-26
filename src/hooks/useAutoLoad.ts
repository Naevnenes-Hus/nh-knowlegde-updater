import { useState } from 'react';
import { Site, Entry } from '../types';
import { StorageService } from '../services/StorageService';
import { PersistentOperationService } from '../services/PersistentOperationService';

interface AutoLoadStatus {
  isActive: boolean;
  currentSite: string;
  progress: { current: number; total: number };
  message: string;
}

export const useAutoLoad = (
  addLog: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void,
  setShowSites: (show: boolean) => void
) => {
  const [autoLoadStatus, setAutoLoadStatus] = useState<AutoLoadStatus>({
    isActive: false,
    currentSite: '',
    progress: { current: 0, total: 0 },
    message: ''
  });

  const startAutoLoad = async (
    sitesToLoad: Site[],
    setSelectedSite: (site: Site | null) => void,
    setEntries: (entries: Entry[]) => void,
    setSites: (sites: Site[]) => void
  ) => {
    if (sitesToLoad.length === 0) {
      return;
    }
    
    setAutoLoadStatus({
      isActive: true,
      currentSite: '',
      progress: { current: 0, total: sitesToLoad.length },
      message: 'Updating site information...'
    });

    // Update site counts in background
    setAutoLoadStatus(prev => ({
      ...prev,
      message: 'Updating site counts...'
    }));

    try {
      const updatedSites: Site[] = [];
      
      for (let i = 0; i < sitesToLoad.length; i++) {
        const site = sitesToLoad[i];
        
        setAutoLoadStatus(prev => ({
          ...prev,
          currentSite: site.name,
          progress: { current: i, total: sitesToLoad.length },
          message: `Updating ${site.name}...`
        }));

        try {
          // Get updated counts from database
          const actualEntryCount = await StorageService.getActualEntryCount(site.url);
          const actualSitemapCount = await StorageService.getSitemapCount(site.url);
          
          // Update site with actual counts
          const updatedSite = {
            ...site,
            entryCount: actualEntryCount,
            sitemapEntryCount: actualSitemapCount
          };
          
          updatedSites.push(updatedSite);
          
          // Update sites progressively
          setSites([...updatedSites]);
          
          // Select first site if none selected
          if (i === 0) {
            setSelectedSite(updatedSite);
          }
        } catch (error) {
          // Still add the site even if loading fails
          updatedSites.push(site);
          setSites([...updatedSites]);
        }
      }
      
      // Final update with all sites
      await StorageService.saveSites(updatedSites);

      setAutoLoadStatus(prev => ({
        ...prev,
        progress: { current: sitesToLoad.length, total: sitesToLoad.length },
        message: `Loaded ${sitesToLoad.length} sites`
      }));

    } catch (error) {
      console.error('Auto-load failed:', error);
    } finally {
      setTimeout(() => {
        setAutoLoadStatus(prev => ({ ...prev, isActive: false }));
      }, 2000);
    }
  };

  return {
    autoLoadStatus,
    startAutoLoad
  };
};