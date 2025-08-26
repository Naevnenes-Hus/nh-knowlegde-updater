import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Entry, Site } from '../types';
import { StorageService } from './StorageService';

interface ExportProgress {
  step: string;
  currentSite: string;
  sitesProcessed: number;
  totalSites: number;
  entriesProcessed: number;
  totalEntries: number;
  isComplete: boolean;
}

export class ExportService {
  static async exportEntriesToZip(
    entries: Entry[], 
    siteName: string, 
    onProgress?: (progress: ExportProgress) => void
  ): Promise<void> {
    if (entries.length === 0) {
      throw new Error('No entries to export');
    }

    const zip = new JSZip();
    let processedCount = 0;
    
    entries.forEach((entry) => {
      // Use the GUID (entry.id) as the filename
      const fileName = `${this.sanitizeFileName(entry.id)}.txt`;
      const content = this.formatEntryContent(entry);
      zip.file(fileName, content);
      processedCount++;
      
      // Update progress every 10 entries or on the last entry
      if (processedCount % 10 === 0 || processedCount === entries.length) {
        onProgress?.({
          step: 'creating-structure',
          currentSite: siteName,
          sitesProcessed: 0,
          totalSites: 1,
          entriesProcessed: processedCount,
          totalEntries: entries.length,
          isComplete: false
        });
      }
    });

    try {
      onProgress?.({
        step: 'generating-zip',
        currentSite: siteName,
        sitesProcessed: 0,
        totalSites: 1,
        entriesProcessed: entries.length,
        totalEntries: entries.length,
        isComplete: false
      });
      
      // Increase timeout for ZIP generation - use compression level 1 for faster generation
      const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 1 // Faster compression
        }
      });
      
      const timestamp = new Date().toISOString().split('T')[0];
      const zipFileName = `${this.sanitizeFileName(siteName)}_entries_${timestamp}.zip`;
      
      onProgress?.({
        step: 'complete',
        currentSite: siteName,
        sitesProcessed: 1,
        totalSites: 1,
        entriesProcessed: entries.length,
        totalEntries: entries.length,
        isComplete: true
      });
      
      saveAs(blob, zipFileName);
    } catch (error) {
      throw new Error('Failed to generate ZIP file: ' + error);
    }
  }

  static async exportAllSitesToZip(
    sites: Site[], 
    onProgress?: (progress: ExportProgress) => void
  ): Promise<void> {
    if (sites.length === 0) {
      throw new Error('No sites to export');
    }

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

    const zip = new JSZip();
    let totalEntries = 0;
    let processedEntries = 0;
    
    // First pass: count total entries using chunked loading
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
      step: 'creating-structure',
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
        step: 'creating-structure',
        currentSite: site.name,
        sitesProcessed: siteIndex,
        totalSites: sites.length,
        entriesProcessed: processedEntries,
        totalEntries: totalEntriesCount,
        isComplete: false
      });
      
      try {
        // Load entries in chunks to avoid timeout
        const entries = await this.loadEntriesInChunks(site.url, site.name, (chunkProgress) => {
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
        
        console.log(`Loaded ${entries.length} entries for ${site.name}`);
        
        if (entries.length > 0) {
          // Create a folder for each site
          const siteFolder = zip.folder(this.sanitizeFileName(site.name));
          
          if (siteFolder) {
            // Sort entries by published date (newest first)
            entries.sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime());
            
            // Group entries by publication date
            const entriesByDate = this.groupEntriesByDate(entries);
            
            // Process entries in batches to avoid blocking the UI
            const batchSize = 100;
            
            // Process each date group
            for (const [dateFolder, dateEntries] of Object.entries(entriesByDate)) {
              const dateFolderInSite = siteFolder.folder(dateFolder);
              
              if (dateFolderInSite) {
                for (let i = 0; i < dateEntries.length; i += batchSize) {
                  const batch = dateEntries.slice(i, i + batchSize);
                  
                  batch.forEach((entry) => {
                    // Use the GUID (entry.id) as the filename
                    const fileName = `${this.sanitizeFileName(entry.id)}.txt`;
                    const content = this.formatEntryContent(entry);
                    dateFolderInSite.file(fileName, content);
                    totalEntries++;
                    processedEntries++;
                  });
                  
                  // Update progress after each batch
                  onProgress?.({
                    step: 'creating-structure',
                    currentSite: site.name,
                    sitesProcessed: siteIndex,
                    totalSites: sites.length,
                    entriesProcessed: processedEntries,
                    totalEntries: totalEntriesCount,
                    isComplete: false
                  });
                  
                  // Small delay to prevent blocking
                  if (i + batchSize < dateEntries.length) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error processing site ${site.name}:`, error);
        // Continue with next site instead of failing completely
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

    try {
      // Use faster compression for large ZIP files
      const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 1 // Faster compression, larger file size
        }
      });
      
      const timestamp = new Date().toISOString().split('T')[0];
      const zipFileName = `all_sites_export_${timestamp}.zip`;
      
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
    } catch (error) {
      throw new Error('Failed to generate ZIP file: ' + error);
    }
  }

  static async exportSiteEntriesToZip(
    site: Site, 
    onProgress?: (progress: ExportProgress) => void
  ): Promise<void> {
    // Load entries for specific site using chunked loading
    onProgress?.({
      step: 'loading-entries',
      currentSite: site.name,
      sitesProcessed: 0,
      totalSites: 1,
      entriesProcessed: 0,
      totalEntries: 0,
      isComplete: false
    });
    
    try {
      const entries = await this.loadEntriesInChunks(site.url, site.name, (chunkProgress) => {
        onProgress?.({
          step: 'loading-entries',
          currentSite: `${site.name} (${chunkProgress.loaded}/${chunkProgress.total})`,
          sitesProcessed: 0,
          totalSites: 1,
          entriesProcessed: chunkProgress.loaded,
          totalEntries: chunkProgress.total,
          isComplete: false
        });
      });
      
      if (entries.length === 0) {
        throw new Error(`No entries found for site: ${site.name}`);
      }

      await this.exportEntriesToZip(entries, site.name, onProgress);
    } catch (error) {
      console.error(`Error exporting site ${site.name}:`, error);
      throw new Error(`Failed to export ${site.name}: ${error.message}`);
    }
  }

  /**
   * Group entries by their publication date
   */
  private static groupEntriesByDate(entries: Entry[]): { [dateFolder: string]: Entry[] } {
    const groups: { [dateFolder: string]: Entry[] } = {};
    
    entries.forEach(entry => {
      let dateFolder = 'unknown-date';
      
      if (entry.publishedDate) {
        try {
          const date = new Date(entry.publishedDate);
          if (!isNaN(date.getTime())) {
            // Format as YYYY-MM-DD
            dateFolder = date.toISOString().split('T')[0];
          }
        } catch (error) {
          console.warn(`Invalid date format for entry ${entry.id}: ${entry.publishedDate}`);
        }
      }
      
      if (!groups[dateFolder]) {
        groups[dateFolder] = [];
      }
      groups[dateFolder].push(entry);
    });
    
    return groups;
  }

  static async exportEntriesToZip(
    entries: Entry[], 
    siteName: string, 
    onProgress?: (progress: ExportProgress) => void
  ): Promise<void> {
    if (entries.length === 0) {
      throw new Error('No entries to export');
    }

    const zip = new JSZip();
    let processedCount = 0;
    
    // Group entries by publication date
    const entriesByDate = this.groupEntriesByDate(entries);
    
    // Process each date group
    for (const [dateFolder, dateEntries] of Object.entries(entriesByDate)) {
      const dateFolderInZip = zip.folder(dateFolder);
      
      if (dateFolderInZip) {
        dateEntries.forEach((entry) => {
          // Use the GUID (entry.id) as the filename
          const fileName = `${this.sanitizeFileName(entry.id)}.txt`;
          const content = this.formatEntryContent(entry);
          dateFolderInZip.file(fileName, content);
          processedCount++;
          
          // Update progress every 10 entries or on the last entry
          if (processedCount % 10 === 0 || processedCount === entries.length) {
            onProgress?.({
              step: 'creating-structure',
              currentSite: siteName,
              sitesProcessed: 0,
              totalSites: 1,
              entriesProcessed: processedCount,
              totalEntries: entries.length,
              isComplete: false
            });
          }
        });
      }
    }

    try {
      onProgress?.({
        step: 'generating-zip',
        currentSite: siteName,
        sitesProcessed: 0,
        totalSites: 1,
        entriesProcessed: entries.length,
        totalEntries: entries.length,
        isComplete: false
      });
      
      // Increase timeout for ZIP generation - use compression level 1 for faster generation
      const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 1 // Faster compression
        }
      });
      
      const timestamp = new Date().toISOString().split('T')[0];
      const zipFileName = `${this.sanitizeFileName(siteName)}_entries_${timestamp}.zip`;
      
      onProgress?.({
        step: 'complete',
        currentSite: siteName,
        sitesProcessed: 1,
        totalSites: 1,
        entriesProcessed: entries.length,
        totalEntries: entries.length,
        isComplete: true
      });
      
      saveAs(blob, zipFileName);
    } catch (error) {
      throw new Error('Failed to generate ZIP file: ' + error);
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
          // Ensure chunk is an array before spreading
          if (Array.isArray(chunk)) {
            allEntries.push(...chunk);
          } else {
            console.warn(`Expected array but got ${typeof chunk} for entries chunk in ${siteName}:`, chunk);
            hasMore = false;
            continue;
          }
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
            if (Array.isArray(smallerChunk) && smallerChunk.length > 0) {
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
              if (!Array.isArray(smallerChunk)) {
                console.warn(`Expected array but got ${typeof smallerChunk} for smaller entries chunk in ${siteName}:`, smallerChunk);
              }
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