import { useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Site, Entry } from '../types';
import { StorageService } from '../services/StorageService';
import { ApiService } from '../services/ApiService';

interface UseSiteOperationsProps {
  sites: Site[];
  setSites: (sites: Site[]) => void;
  selectedSite: Site | null;
  setSelectedSite: (site: Site | null) => void;
  addLog: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  newEntriesCount: { [siteId: string]: number };
  setNewEntriesCount: (count: { [siteId: string]: number } | ((prev: { [siteId: string]: number }) => { [siteId: string]: number })) => void;
  loadEntries: (siteUrl: string) => Promise<void>;
  maxEntries: number;
}

export const useSiteOperations = ({
  sites,
  setSites,
  selectedSite,
  setSelectedSite,
  addLog,
  isLoading,
  setIsLoading,
  abortControllerRef,
  newEntriesCount,
  setNewEntriesCount,
  loadEntries,
  maxEntries
}: UseSiteOperationsProps) => {
  const [fetchStatus, setFetchStatus] = useState<{
    isActive: boolean;
    operation: string;
    siteName: string;
    progress: { current: number; total: number };
    message: string;
  }>({
    isActive: false,
    operation: '',
    siteName: '',
    progress: { current: 0, total: 0 },
    message: ''
  });

  const handleAddSite = async (url: string) => {
    try {
      const existingSite = await StorageService.getSiteByUrl(url);
      if (existingSite) {
        addLog(`Site already exists: ${existingSite.name}`, 'warning');
        return;
      }

      const siteName = new URL(url).hostname;
      const newSite: Site = {
        id: uuidv4(),
        url,
        name: siteName,
        lastUpdated: new Date(),
        entryCount: 0,
        sitemapEntryCount: 0
      };

      const updatedSites = [...sites, newSite];
      setSites(updatedSites);
      await StorageService.saveSites(updatedSites);
      addLog(`Added site: ${siteName}`, 'success');
    } catch (error) {
      addLog(`Failed to add site: ${error.message}`, 'error');
    }
  };

  const handleEditSite = async (siteId: string, newUrl: string) => {
    try {
      const updatedSites = sites.map(site => 
        site.id === siteId 
          ? { ...site, url: newUrl, name: new URL(newUrl).hostname }
          : site
      );
      setSites(updatedSites);
      await StorageService.saveSites(updatedSites);
      addLog(`Updated site URL`, 'success');
    } catch (error) {
      addLog(`Failed to update site: ${error.message}`, 'error');
    }
  };

  const handleRemoveSite = async (siteId: string) => {
    try {
      await StorageService.deleteSite(siteId);
      const updatedSites = sites.filter(site => site.id !== siteId);
      setSites(updatedSites);
      
      if (selectedSite?.id === siteId) {
        setSelectedSite(null);
      }
      
      addLog(`Removed site`, 'success');
    } catch (error) {
      addLog(`Failed to remove site: ${error.message}`, 'error');
    }
  };

  const handleUpdateSitemap = async (site: Site) => {
    if (isLoading) return;
    
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    
    setFetchStatus({
      isActive: true,
      operation: 'sitemap',
      siteName: site.name,
      progress: { current: 0, total: 1 },
      message: 'Fetching sitemap...'
    });
    
    try {
      addLog(`Updating sitemap for ${site.name}...`, 'info');
      
      setFetchStatus(prev => ({
        ...prev,
        progress: { current: 0, total: 1 },
        message: 'Downloading sitemap XML...'
      }));
      
      const guids = await ApiService.fetchSitemap(site.url, abortControllerRef.current.signal);
      
      addLog(`Getting existing entry IDs for ${site.name}...`, 'info');
      
      setFetchStatus(prev => ({
        ...prev,
        message: 'Checking existing entries...'
      }));
      
      const existingIds = new Set(await StorageService.getExistingEntryIdsForSite(site.url, guids));
      
      addLog(`Downloaded sitemap for ${site.name}: ${guids.length} entries found`, 'info');
      
      setFetchStatus(prev => ({
        ...prev,
        message: 'Saving sitemap to database...'
      }));
      
      let sitemapSaveSuccess = false;
      let actualSitemapCount = 0;
      
      try {
        await StorageService.saveSitemap(site.url, guids);
        sitemapSaveSuccess = true;
        
        // Wait a moment for database consistency
        await new Promise(resolve => setTimeout(resolve, 1000));
        actualSitemapCount = await StorageService.getSitemapCount(site.url);
        
        // If count is still 0, try one more time
        if (actualSitemapCount === 0 && guids.length > 0) {
          addLog(`Retrying sitemap count check for ${site.name}...`, 'info');
          await new Promise(resolve => setTimeout(resolve, 2000));
          actualSitemapCount = await StorageService.getSitemapCount(site.url);
        }
      } catch (error) {
        sitemapSaveSuccess = false;
        addLog(`Failed to save sitemap to database: ${error.message}`, 'error');
        actualSitemapCount = guids.length;
      }

      const newGuids = guids.filter(guid => !existingIds.has(guid));
      
      setNewEntriesCount(prev => ({
        ...prev,
        [site.id]: newGuids.length
      }));
      
      const updatedSite = { 
        ...site, 
        sitemapEntryCount: actualSitemapCount,
        entryCount: existingIds.size,
        lastUpdated: new Date() 
      };

      const updatedSites = sites.map(s => s.id === site.id ? updatedSite : s);
      setSites(updatedSites);
      await StorageService.saveSites(updatedSites);

      if (selectedSite?.id === site.id) {
        setSelectedSite(updatedSite);
      }

      try {
        const statusMessage = sitemapSaveSuccess 
          ? `Updated sitemap for ${site.name}: ${actualSitemapCount} entries in sitemap, ${newGuids.length} new entries available to fetch`
          : `Updated sitemap for ${site.name}: ${guids.length} entries downloaded but database save failed, ${newGuids.length} new entries available to fetch`;
        addLog(statusMessage, 'success');
        addLog(`📊 Sitemap counts updated: ${actualSitemapCount} in database for ${site.name}`, 'info');
      } catch (error) {
        addLog(`⚠️ Error logging sitemap update status: ${error.message}`, 'warning');
      }
      
      setFetchStatus(prev => ({
        ...prev,
        progress: { current: 1, total: 1 },
        message: `Completed: ${actualSitemapCount} entries (${newGuids.length} new)`
      }));
    } catch (error) {
      if (error.message !== 'AbortError') {
        addLog(`Failed to update sitemap: ${error.message}`, 'error');
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      setTimeout(() => setFetchStatus(prev => ({ ...prev, isActive: false })), 2000);
    }
  };

  const handleFetchEntries = async (site: Site) => {
    if (isLoading) return;
    
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    
    setFetchStatus({
      isActive: true,
      operation: 'entries',
      siteName: site.name,
      progress: { current: 0, total: 0 },
      message: 'Preparing to fetch entries...'
    });
    
    try {
      addLog(`Fetching entries for ${site.name}...`, 'info');
      
      const existingEntries = await StorageService.loadAllEntriesForSite(site.url);
      const existingIds = new Set(existingEntries.map(entry => entry.id));
      
      setFetchStatus(prev => ({
        ...prev,
        message: 'Loading existing entries...'
      }));
      
      const allGuids = await StorageService.loadSitemap(site.url);
      
      addLog(`Loaded sitemap for ${site.name}: ${allGuids.length} total entries`, 'info');
      
      if (allGuids.length === 0) {
        addLog(`No sitemap found for ${site.name}. Please update sitemap first.`, 'warning');
        setFetchStatus(prev => ({
          ...prev,
          message: 'No sitemap found - update sitemap first'
        }));
        setTimeout(() => setFetchStatus(prev => ({ ...prev, isActive: false })), 3000);
        setIsLoading(false);
        return;
      }
      
      const newGuids = allGuids.filter(guid => !existingIds.has(guid));
      
      if (newGuids.length === 0) {
        addLog(`No new entries found for ${site.name}`, 'info');
        setFetchStatus(prev => ({
          ...prev,
          message: 'No new entries found'
        }));
        setTimeout(() => setFetchStatus(prev => ({ ...prev, isActive: false })), 2000);
        setIsLoading(false);
        return;
      }
      
      addLog(`Found ${newGuids.length} new entries for ${site.name}`, 'info');
      
      // Determine how many entries to fetch based on maxEntries setting
      const guidsToFetch = maxEntries === 0 ? newGuids : newGuids.slice(0, maxEntries);
      
      addLog(`Max entries setting: ${maxEntries === 0 ? 'ALL' : maxEntries}. Will fetch ${guidsToFetch.length} of ${newGuids.length} new entries`, 'info');
      
      setFetchStatus(prev => ({
        ...prev,
        progress: { current: 0, total: guidsToFetch.length },
        message: `Fetching ${guidsToFetch.length} entries...`
      }));
      
      addLog(`Fetching ${guidsToFetch.length} entries for ${site.name}...`, 'info');
      
      // Fetch entries in batches
      let allFetchedEntries: any[] = [];
      let allFailed: string[] = [];
      
      // Process in chunks of 5000 entries at a time for maximum speed
      const chunkSize = 5000;
      const saveBatchSize = 200; // Reduced to 200 entries per batch to avoid timeouts
      
      let totalSavedCount = 0;
      let pendingEntries: any[] = [];
      
      for (let i = 0; i < guidsToFetch.length; i += chunkSize) {
        if (abortControllerRef.current?.signal.aborted) {
          addLog('Entry fetch stopped by user', 'warning');
          return;
        }
        
        const chunk = guidsToFetch.slice(i, i + chunkSize);
        const chunkEnd = Math.min(i + chunkSize, guidsToFetch.length);
        
        addLog(`Processing chunk ${Math.floor(i / chunkSize) + 1}: entries ${i + 1}-${chunkEnd} of ${guidsToFetch.length}`, 'info');
        
        setFetchStatus(prev => ({
          ...prev,
          message: `Processing chunk ${Math.floor(i / chunkSize) + 1}: ${i + 1}-${chunkEnd} of ${guidsToFetch.length}`
        }));
        
        const { success: chunkEntries, failed: chunkFailed } = await ApiService.fetchPublicationsBatch(
          site.url,
          chunk,
          abortControllerRef.current?.signal,
          (completed, total) => {
            const overallCompleted = i + completed;
            setFetchStatus(prev => ({
              ...prev,
              progress: { current: overallCompleted, total: guidsToFetch.length },
              message: `Fetching entries: ${overallCompleted}/${guidsToFetch.length} (chunk ${Math.floor(i / chunkSize) + 1})`
            }));
          }
        );
        
        allFetchedEntries.push(...chunkEntries);
        allFailed.push(...chunkFailed);
        
        // Save this chunk to database immediately
        setFetchStatus(prev => ({
          ...prev,
          message: `Processing chunk ${Math.floor(i / chunkSize) + 1} entries...`
        }));
        
        let chunkSavedCount = 0;
        for (const entryData of chunkEntries) {
          const entry: Entry = {
            id: entryData.id || entryData.guid,
            title: entryData.title || '',
            abstract: entryData.abstract || '',
            body: entryData.body || '',
            publishedDate: entryData.published_date || entryData.date || '',
            type: entryData.type || 'publication',
            seen: false,
            metadata: entryData,
            siteUrl: site.url
          };
          
          pendingEntries.push(entry);
          
          // Save batch when we reach the batch size (200 entries)
          if (pendingEntries.length >= saveBatchSize) {
            try {
              setFetchStatus(prev => ({
                ...prev,
                message: `Saving batch of ${pendingEntries.length} entries to database...`
              }));
              
              // Use batch save for much better performance
              const batchToSave = [...pendingEntries]; // Copy the batch
              const batchSize = batchToSave.length;
              
              await StorageService.saveEntriesBatch(site.url, batchToSave);
              chunkSavedCount += batchSize;
              totalSavedCount += batchSize;
              
              // Don't log here - DatabaseService handles the activity logging
              pendingEntries = []; // Clear the batch
            } catch (error) {
              console.error(`Failed to save batch of ${pendingEntries.length} entries:`, error);
              
              if (error.message.includes('timeout') || error.message.includes('Partial save')) {
                // For timeout errors, log as warning and continue
                addLog(`⚠️ Batch save timeout: ${error.message}`, 'warning');
                
                // Try to get the actual count of saved entries from the error message
                const partialMatch = error.message.match(/(\d+)\/\d+ entries saved/);
                if (partialMatch) {
                  const partiallySaved = parseInt(partialMatch[1]);
                  totalSavedCount += partiallySaved;
                  // Don't log here - DatabaseService handles the activity logging
                }
              } else {
                // Don't log here - DatabaseService handles the activity logging
              }
              
              // Clear the batch to continue with next entries
              pendingEntries = [];
            }
          }
        }
        
        addLog(`Chunk ${Math.floor(i / chunkSize) + 1} processed: ${chunkEntries.length} entries fetched`, 'info');
        
        // Minimal delay between chunks for maximum speed
        if (i + chunkSize < guidsToFetch.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      // Save any remaining entries in the final batch
      if (pendingEntries.length > 0) {
        try {
          setFetchStatus(prev => ({
            ...prev,
            message: `Saving final batch of ${pendingEntries.length} entries...`
          }));
          
          // Use batch save for the final batch too
          const finalBatchSize = pendingEntries.length;
          try {
            await StorageService.saveEntriesBatch(site.url, pendingEntries);
            totalSavedCount += finalBatchSize;
            // Don't log here - DatabaseService handles the activity logging
          } catch (error) {
            console.error(`Failed to save final batch:`, error);
            
            if (error.message.includes('timeout') || error.message.includes('Partial save')) {
              addLog(`⚠️ Final batch save timeout: ${error.message}`, 'warning');
              
              // Try to get the actual count of saved entries from the error message
              const partialMatch = error.message.match(/(\d+)\/\d+ entries saved/);
              if (partialMatch) {
                const partiallySaved = parseInt(partialMatch[1]);
                totalSavedCount += partiallySaved;
                // Don't log here - DatabaseService handles the activity logging
              }
            } else {
              // Don't log here - DatabaseService handles the activity logging
            }
          }
          
        } catch (error) {
          console.error(`Failed to save final batch:`, error);
          // Don't log here - DatabaseService handles the activity logging
        }
      }
      
      const fetchedEntries = allFetchedEntries;
      const failed = allFailed;
      
      addLog(`Fetch completed: ${fetchedEntries.length} successful, ${failed.length} failed`, 'info');
      
      // All entries have been saved during chunk processing
      const savedCount = totalSavedCount;
      
      // Update site counts
      setFetchStatus(prev => ({
        ...prev,
        message: 'Updating site counts...'
      }));
      
      try {
        const actualEntryCount = await StorageService.getActualEntryCount(site.url);
        const actualSitemapCount = await StorageService.getSitemapCount(site.url);
        
        const updatedSite = {
          ...site,
          entryCount: actualEntryCount,
          sitemapEntryCount: actualSitemapCount,
          lastUpdated: new Date()
        };
        
        const updatedSites = sites.map(s => s.id === site.id ? updatedSite : s);
        setSites(updatedSites);
        await StorageService.saveSites(updatedSites);
        
        if (selectedSite?.id === site.id) {
          setSelectedSite(updatedSite);
          // Force refresh entries from database
          const refreshedEntries = await StorageService.loadAllEntriesForSite(site.url);
          setEntries(refreshedEntries);
        }
        
        addLog(`📊 Final site counts updated: ${actualEntryCount} entries, ${actualSitemapCount} in sitemap for ${site.name}`, 'success');
      } catch (countError) {
        console.error(`Failed to update final site counts for ${site.name}:`, countError);
        addLog(`⚠️ Failed to update final site counts for ${site.name}: ${countError.message}`, 'warning');
      }
      
      // Clear new entries count for this site
      setNewEntriesCount(prev => ({
        ...prev,
        [site.id]: 0 // Reset to 0 since we just fetched all available new entries
      }));
      
      const successMessage = `Fetched ${savedCount} entries for ${site.name}`;
      if (failed.length > 0) {
        addLog(`${successMessage}. ${failed.length} entries failed to fetch.`, 'warning');
      } else {
        addLog(successMessage, 'success');
      }
      
      setFetchStatus(prev => ({
        ...prev,
        progress: { current: guidsToFetch.length, total: guidsToFetch.length },
        message: `Completed: ${savedCount} entries saved`
      }));
      
      // Mark the newly fetched entries as "recently fetched" for the New tab
      const recentlyFetchedIds = fetchedEntries.map(entry => entry.id || entry.guid);
      localStorage.setItem(`recently-fetched-${site.id}`, JSON.stringify({
        ids: recentlyFetchedIds,
        timestamp: Date.now()
      }));
    } catch (error) {
      if (error.message !== 'AbortError') {
        addLog(`Failed to fetch entries: ${error.message}`, 'error');
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      setTimeout(() => setFetchStatus(prev => ({ ...prev, isActive: false })), 3000);
    }
  };

  const handleDeleteAllEntries = async (site: Site) => {
    try {
      await StorageService.deleteAllEntries(site.url);
      
      // Get updated counts from database
      const actualEntryCount = await StorageService.getActualEntryCount(site.url);
      const actualSitemapCount = await StorageService.getSitemapCount(site.url);
      
      // Update site with new counts
      const updatedSite = {
        ...site,
        entryCount: actualEntryCount,
        sitemapEntryCount: actualSitemapCount,
        lastUpdated: new Date()
      };
      
      // Update sites list
      const updatedSites = sites.map(s => s.id === site.id ? updatedSite : s);
      setSites(updatedSites);
      
      try {
        await StorageService.saveSites(updatedSites);
        addLog(`📊 Site counts updated after deletion: ${actualEntryCount} entries, ${actualSitemapCount} in sitemap for ${site.name}`, 'info');
      } catch (saveError) {
        console.error(`Failed to save updated site counts for ${site.name}:`, saveError);
        addLog(`⚠️ Failed to save updated site counts for ${site.name}: ${saveError.message}`, 'warning');
      }
      
      // Update selected site if it's the current one
      if (selectedSite?.id === site.id) {
        setSelectedSite(updatedSite);
        // Force refresh entries from database
        const refreshedEntries = await StorageService.loadAllEntriesForSite(site.url);
        setEntries(refreshedEntries);
      }
      
      addLog(`Deleted all entries for ${site.name}`, 'success');
    } catch (error) {
      addLog(`Failed to delete all entries: ${error.message}`, 'error');
    }
  };

  const handleExportEntries = async (site: Site) => {
    try {
      await ExportService.exportSiteEntriesToZip(site, (progress) => {
        // For single site export, we can show a simple progress
        console.log('Single site export progress:', progress);
      });
      addLog(`Exported entries for ${site.name}`, 'success');
    } catch (error) {
      addLog(`Failed to export entries: ${error.message}`, 'error');
    }
  };

  const handleUpdateAllSitemaps = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    
    try {
      addLog(`Updating sitemaps for all ${sites.length} sites...`, 'info');
      
      for (let i = 0; i < sites.length; i++) {
        const site = sites[i];
        
        if (abortControllerRef.current?.signal.aborted) {
          addLog('Bulk sitemap update stopped by user', 'warning');
          break;
        }
        
        try {
          await handleUpdateSitemap(site);
        } catch (error) {
          if (error.message !== 'AbortError') {
            addLog(`Failed to update sitemap for ${site.name}: ${error.message}`, 'error');
          }
        }
      }
      
      addLog(`Completed bulk sitemap update`, 'success');
    } catch (error) {
      if (error.message !== 'AbortError') {
        addLog(`Bulk sitemap update failed: ${error.message}`, 'error');
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleFetchAllEntries = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    
    try {
      addLog(`Fetching entries for all ${sites.length} sites...`, 'info');
      
      for (let i = 0; i < sites.length; i++) {
        const site = sites[i];
        
        if (abortControllerRef.current?.signal.aborted) {
          addLog('Bulk entry fetch stopped by user', 'warning');
          break;
        }
        
        try {
          await handleFetchEntries(site);
        } catch (error) {
          if (error.message !== 'AbortError') {
            addLog(`Failed to fetch entries for ${site.name}: ${error.message}`, 'error');
          }
        }
      }
      
      addLog(`Completed bulk entry fetch`, 'success');
    } catch (error) {
      if (error.message !== 'AbortError') {
        addLog(`Bulk entry fetch failed: ${error.message}`, 'error');
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleDeleteAllEntriesAllSites = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    
    try {
      addLog(`Deleting all entries for all ${sites.length} sites...`, 'info');
      
      const updatedSites: Site[] = [];
      
      for (const site of sites) {
        try {
          await StorageService.deleteAllEntries(site.url);
          
          // Get updated counts
          const actualEntryCount = await StorageService.getActualEntryCount(site.url);
          const actualSitemapCount = await StorageService.getSitemapCount(site.url);
          
          const updatedSite = {
            ...site,
            entryCount: actualEntryCount,
            sitemapEntryCount: actualSitemapCount,
            lastUpdated: new Date()
          };
          
          updatedSites.push(updatedSite);
          addLog(`Deleted all entries for ${site.name}`, 'info');
        } catch (error) {
          updatedSites.push(site);
          addLog(`Failed to delete entries for ${site.name}: ${error.message}`, 'error');
        }
      }
      
      // Update all sites
      setSites(updatedSites);
      
      try {
        await StorageService.saveSites(updatedSites);
        addLog(`📊 All site counts updated after bulk deletion`, 'info');
      } catch (saveError) {
        console.error(`Failed to save updated site counts after bulk deletion:`, saveError);
        addLog(`⚠️ Failed to save updated site counts after bulk deletion: ${saveError.message}`, 'warning');
      }
      
      // Update selected site if needed
      if (selectedSite) {
        const updatedSelectedSite = updatedSites.find(s => s.id === selectedSite.id);
        if (updatedSelectedSite) {
          setSelectedSite(updatedSelectedSite);
          // Force refresh entries from database
          const refreshedEntries = await StorageService.loadAllEntriesForSite(updatedSelectedSite.url);
          setEntries(refreshedEntries);
        }
      }
      
      addLog(`Completed deleting all entries for all sites`, 'success');
    } catch (error) {
      addLog(`Failed to delete all entries: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return {
    fetchStatus,
    handleAddSite,
    handleEditSite,
    handleRemoveSite,
    handleUpdateSitemap,
    handleFetchEntries,
    handleDeleteAllEntries,
    handleExportEntries,
    handleUpdateAllSitemaps,
    handleFetchAllEntries,
    handleDeleteAllEntriesAllSites
  };
};