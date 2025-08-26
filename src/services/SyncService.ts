import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Entry, Site } from '../types';
import { StorageService } from './StorageService';

interface SyncProgress {
  step: string;
  currentSite: string;
  sitesProcessed: number;
  totalSites: number;
  entriesProcessed: number;
  totalEntries: number;
  isComplete: boolean;
}

export class SyncService {
  /**
   * Sync all entries to a downloadable ZIP file with proper folder structure
   */
  static async syncToFolder(
    sites: Site[], 
    onProgress?: (progress: SyncProgress) => void
  ): Promise<void> {
    if (sites.length === 0) {
      throw new Error('No sites to sync');
    }

    console.log(`Starting sync for ${sites.length} sites...`);

    // Initialize progress
    onProgress?.({
      step: 'loading-sites',
      currentSite: '',
      sitesProcessed: 0,
      totalSites: sites.length,
      entriesProcessed: 0,
      totalEntries: 0,
      isComplete: false
    });

    // Create ZIP with proper folder structure BEFORE marking entries as seen
    await this.createSyncZip(sites, onProgress);
  }

  /**
   * Create a ZIP file with the proper folder structure:
   * - One folder per site containing all entries
   * - new_entries subfolder in each site folder containing only new entries
   * - Files named using GUID (entry.id)
   */
  private static async createSyncZip(
    sites: Site[], 
    onProgress?: (progress: SyncProgress) => void
  ): Promise<void> {
    const zip = new JSZip();
    let totalEntries = 0;
    let totalNewEntries = 0;
    let processedEntries = 0;
    
    console.log('Creating ZIP structure...');
    
    // First pass: count total entries
    onProgress?.({
      step: 'loading-entries',
      currentSite: 'Counting total entries...',
      sitesProcessed: 0,
      totalSites: sites.length,
      entriesProcessed: 0,
      totalEntries: 0,
      isComplete: false
    });
    
    let totalEntriesCount = 0;
    for (const site of sites) {
      try {
        const count = await StorageService.getActualEntryCount(site.url);
        totalEntriesCount += count;
        console.log(`Site ${site.name}: ${count} entries`);
      } catch (error) {
        console.error(`Error counting entries for ${site.name}:`, error);
      }
    }
    
    onProgress?.({
      step: 'creating-zip',
      currentSite: '',
      sitesProcessed: 0,
      totalSites: sites.length,
      entriesProcessed: 0,
      totalEntries: totalEntriesCount,
      isComplete: false
    });
    
    for (let siteIndex = 0; siteIndex < sites.length; siteIndex++) {
      const site = sites[siteIndex];
      
      onProgress?.({
        step: 'creating-zip',
        currentSite: site.name,
        sitesProcessed: siteIndex,
        totalSites: sites.length,
        entriesProcessed: processedEntries,
        totalEntries: totalEntriesCount,
        isComplete: false
      });
      
      try {
        // Load entries in chunks to avoid timeout
        const allEntries = await this.loadEntriesInChunks(site.url, site.name, (chunkProgress) => {
          onProgress?.({
            step: 'loading-entries',
            currentSite: `${site.name} (${chunkProgress.loaded}/${chunkProgress.total})`,
            sitesProcessed: siteIndex,
            totalSites: sites.length,
            entriesProcessed: processedEntries + chunkProgress.loaded,
            totalEntries: totalEntriesCount,
            isComplete: false
          });
        });
        
        // Get new entries BEFORE they might be marked as seen
        const newEntries = allEntries.filter(entry => !entry.seen);
        
        console.log(`Site ${site.name}: ${allEntries.length} total entries, ${newEntries.length} new entries`);
        
        if (allEntries.length > 0) {
          // Create main site folder
          const siteFolderName = this.sanitizeFileName(site.name);
          const siteFolder = zip.folder(siteFolderName);
          
          if (siteFolder) {
            // Sort entries by published date (newest first)
            allEntries.sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime());
            
            // Process entries in batches to avoid blocking the UI
            const batchSize = 100;
            for (let i = 0; i < allEntries.length; i += batchSize) {
              const batch = allEntries.slice(i, i + batchSize);
              
              // Add ALL entries to the main site folder using GUID as filename
              batch.forEach((entry) => {
                const fileName = `${this.sanitizeFileName(entry.id)}.txt`;
                const content = this.formatEntryContent(entry);
                siteFolder.file(fileName, content);
                totalEntries++;
                processedEntries++;
              });
              
              // Update progress after each batch
              onProgress?.({
                step: 'creating-zip',
                currentSite: site.name,
                sitesProcessed: siteIndex,
                totalSites: sites.length,
                entriesProcessed: processedEntries,
                totalEntries: totalEntriesCount,
                isComplete: false
              });
              
              // Small delay to prevent blocking
              if (i + batchSize < allEntries.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
              }
            }
            
            // ALWAYS create "new_entries" subfolder, even if empty
            const newEntriesFolder = siteFolder.folder('new_entries');
            
            if (newEntriesFolder && newEntries.length > 0) {
              console.log(`Creating new_entries subfolder for ${site.name} with ${newEntries.length} entries`);
              
              // Sort new entries by published date (newest first)
              newEntries.sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime());
              
              // Process new entries in batches
              for (let i = 0; i < newEntries.length; i += batchSize) {
                const batch = newEntries.slice(i, i + batchSize);
                
                batch.forEach((entry) => {
                  const fileName = `${this.sanitizeFileName(entry.id)}.txt`;
                  const content = this.formatEntryContent(entry);
                  newEntriesFolder.file(fileName, content);
                  totalNewEntries++;
                });
                
                // Small delay to prevent blocking
                if (i + batchSize < newEntries.length) {
                  await new Promise(resolve => setTimeout(resolve, 10));
                }
              }
            } else {
              console.log(`No new entries for ${site.name} - empty new_entries subfolder created`);
            }
            
            // Add site info file
            const siteInfo = this.formatSiteInfo(site, allEntries.length, newEntries.length);
            siteFolder.file('_site_info.txt', siteInfo);
          }
        } else {
          console.log(`No entries found for ${site.name} - skipping`);
        }
      } catch (error) {
        console.error(`Error processing site ${site.name}:`, error);
      }
      
      // Small delay between sites to prevent blocking
      if (siteIndex + 1 < sites.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    if (totalEntries === 0) {
      throw new Error('No entries found across all sites');
    }

    // Update progress for ZIP generation
    onProgress?.({
      step: 'generating-zip',
      currentSite: '',
      sitesProcessed: sites.length,
      totalSites: sites.length,
      entriesProcessed: processedEntries,
      totalEntries: totalEntriesCount,
      isComplete: false
    });

    // Add summary file at root level
    const summaryContent = this.formatSummary(sites, totalEntries, totalNewEntries);
    zip.file('_sync_summary.txt', summaryContent);

    try {
      // Use faster compression for large sync ZIP files
      const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 1 // Faster compression, larger file size
        }
      });
      
      const timestamp = new Date().toISOString().split('T')[0];
      const zipFileName = `knowledge_sync_${timestamp}.zip`;
      
      // Final progress update
      onProgress?.({
        step: 'complete',
        currentSite: '',
        sitesProcessed: sites.length,
        totalSites: sites.length,
        entriesProcessed: processedEntries,
        totalEntries: totalEntriesCount,
        isComplete: true
      });
      
      saveAs(blob, zipFileName);
      console.log(`ZIP download completed: ${totalEntries} total entries, ${totalNewEntries} new entries`);
    } catch (error) {
      throw new Error('Failed to generate sync ZIP: ' + error);
    }
  }

  /**
   * Load entries in chunks to avoid database timeouts
   */
  private static async loadEntriesInChunks(
    siteUrl: string, 
    siteName: string,
    onProgress?: (progress: { loaded: number; total: number }) => void
  ): Promise<Entry[]> {
    const chunkSize = 50; // Very small chunks for maximum reliability
    let allEntries: Entry[] = [];
    let offset = 0;
    let hasMore = true;
    
    // First get the total count
    let totalCount = 0;
    try {
      totalCount = await StorageService.getActualEntryCount(siteUrl);
      console.log(`Total entries for ${siteName}: ${totalCount}`);
    } catch (error) {
      console.warn(`Could not get total count for ${siteName}, loading incrementally`);
    }
    
    while (hasMore) {
      try {
        console.log(`Loading chunk ${Math.floor(offset / chunkSize) + 1} for ${siteName} (offset: ${offset}, limit: ${chunkSize})`);
        
        // Load chunk with timeout handling
        const chunk = await Promise.race([
          StorageService.loadEntriesWithLimit(siteUrl, chunkSize, offset),
          new Promise<Entry[]>((_, reject) => 
            setTimeout(() => reject(new Error('Chunk load timeout')), 25000) // 25 second timeout per chunk
          )
        ]);
        
        console.log(`Loaded ${chunk.length} entries in chunk for ${siteName}`);
        
        if (chunk.length === 0) {
          hasMore = false;
        } else {
          allEntries.push(...chunk);
          offset += chunk.length;
          
          // Update progress
          onProgress?.({
            loaded: allEntries.length,
            total: totalCount || allEntries.length
          });
          
          // If we got fewer entries than requested, we've reached the end
          if (chunk.length < chunkSize) {
            hasMore = false;
          }
          
          // Longer delay between chunks for database stability
          await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second delay
        }
      } catch (error) {
        console.error(`Error loading chunk for ${siteName} at offset ${offset}:`, error);
        
        if (error.message === 'Chunk load timeout') {
          console.warn(`Chunk timeout for ${siteName}, trying smaller chunk size`);
          // Try with smaller chunk size
          try {
            const smallerChunk = await StorageService.loadEntriesWithLimit(siteUrl, 20, offset); // Even smaller fallback
            if (smallerChunk.length > 0) {
              allEntries.push(...smallerChunk);
              offset += smallerChunk.length;
              
              onProgress?.({
                loaded: allEntries.length,
                total: totalCount || allEntries.length
              });
              
              if (smallerChunk.length < 20) {
                hasMore = false;
              }
              
              // Extra delay after timeout recovery
              await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay after recovery
            } else {
              hasMore = false;
            }
          } catch (smallerError) {
            console.error(`Even smaller chunk failed for ${siteName}:`, smallerError);
            hasMore = false;
          }
        } else {
          // For other errors, stop loading this site
          console.error(`Stopping chunk loading for ${siteName} due to error:`, error);
          hasMore = false;
        }
      }
    }
    
    console.log(`Finished loading ${allEntries.length} entries for ${siteName}`);
    return allEntries;
  }

  /**
   * Clear all new entries (mark them as seen) across all sites
   */
  static async clearNewEntries(sites: Site[]): Promise<number> {
    let clearedCount = 0;
    
    console.log('Marking new entries as seen...');
    
    for (const site of sites) {
      try {
        const entries = await StorageService.loadEntries(site.url);
        const newEntries = entries.filter(entry => !entry.seen);
        
        for (const entry of newEntries) {
          const updatedEntry = { ...entry, seen: true };
          await StorageService.markEntryAsSeen(updatedEntry);
          clearedCount++;
        }
        
        console.log(`Marked ${newEntries.length} entries as seen for ${site.name}`);
      } catch (error) {
        console.warn(`Failed to clear new entries for ${site.url}:`, error);
      }
    }
    
    console.log(`Total entries marked as seen: ${clearedCount}`);
    return clearedCount;
  }

  private static formatSiteInfo(site: Site, totalEntries: number, newEntries: number): string {
    return [
      `Site Information`,
      `================`,
      ``,
      `Name: ${site.name}`,
      `URL: ${site.url}`,
      `Last Updated: ${site.lastUpdated.toLocaleString('da-DK')}`,
      `Total Entries: ${totalEntries}`,
      `New Entries: ${newEntries}`,
      `Sitemap Entries: ${site.sitemapEntryCount}`,
      ``,
      `Sync Date: ${new Date().toLocaleString('da-DK')}`,
      ``,
      `Folder Structure:`,
      `- All entries are in the main site folder (files named by GUID)`,
      `- New (unseen) entries are also in the 'new_entries' subfolder`,
      `- After sync, all entries are marked as seen`
    ].join('\n');
  }

  private static formatSummary(sites: Site[], totalEntries: number, totalNewEntries: number): string {
    const siteList = sites.map(site => `- ${site.name} (${site.url})`).join('\n');
    
    return [
      `Knowledge Sync Summary`,
      `=====================`,
      ``,
      `Sync Date: ${new Date().toLocaleString('da-DK')}`,
      `Total Sites: ${sites.length}`,
      `Total Entries: ${totalEntries}`,
      `Total New Entries: ${totalNewEntries}`,
      ``,
      `Sites Included:`,
      siteList,
      ``,
      `ZIP Structure:`,
      `- Each site has its own folder named after the site`,
      `- All entries for each site are in the main site folder (files named by GUID)`,
      `- New entries are ALSO in a 'new_entries' subfolder within each site folder`,
      `- Site information is in '_site_info.txt' in each site folder`,
      `- This summary is in '_sync_summary.txt' at the root`,
      ``,
      `File Naming:`,
      `- All entry files are named using their GUID (e.g., 'abc123def456.txt')`,
      `- Each file contains the full entry data in structured format`,
      ``,
      `Note: After this sync, all entries are marked as 'seen'`,
      `The 'new_entries' subfolders will be empty on the next sync unless new entries are fetched.`
    ].join('\n');
  }

  private static formatEntryContent(entry: Entry): string {
    // Extract values from entry and metadata
    const metadata = entry.metadata || {};
    
    const content = [
      `id: ${entry.id || ''}`,
      `type: ${entry.type || ''}`,
      `jnr: ${metadata.jnr || ''}`,
      `title: ${entry.title || ''}`,
      `published_date: ${entry.publishedDate || ''}`,
      `date: ${metadata.date || entry.publishedDate || ''}`,
      `is_board_ruling: ${metadata.is_board_ruling || ''}`,
      `is_brought_to_court: ${metadata.is_brought_to_court || ''}`,
      `authority: ${metadata.authority || ''}`,
      `categories: ${Array.isArray(metadata.categories) ? metadata.categories.join(', ') : metadata.categories || ''}`,
      `seen: ${entry.seen ? 'true' : 'false'}`,
      `site_url: ${entry.siteUrl || ''}`,
      `abstract: ${entry.abstract || ''}`,
      `body: ${entry.body || ''}`
    ].join('\n');

    return content;
  }

  private static sanitizeFileName(fileName: string): string {
    // Remove or replace invalid characters for file names
    return fileName
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 100); // Increased length limit for GUIDs
  }
}