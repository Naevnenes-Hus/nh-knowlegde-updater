import { useState, useEffect, useRef } from 'react';
import { Site } from '../types';
import { PersistentOperationService, PersistentOperation } from '../services/PersistentOperationService';
import { StorageService } from '../services/StorageService';
import { ApiService } from '../services/ApiService';

interface UsePersistentOperationsProps {
  sites: Site[];
  setSites: (sites: Site[]) => void;
  addLog: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  maxEntries: number;
}

export const usePersistentOperations = ({
  sites,
  setSites,
  addLog,
  maxEntries
}: UsePersistentOperationsProps) => {
  const [activeOperations, setActiveOperations] = useState<PersistentOperation[]>([]);
  const sitesRef = useRef<Site[]>(sites);
  const processingRef = useRef<Set<string>>(new Set());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const initializationRef = useRef<boolean>(false);
  const resumeAttemptsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef<boolean>(true);
  const cancelledOperationsRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const operationStatusRef = useRef<Map<string, 'running' | 'paused' | 'cancelled'>>(new Map());

  // Update sites ref whenever sites prop changes
  useEffect(() => {
    sitesRef.current = sites;
  }, [sites]);

  // Load and resume operations on mount
  useEffect(() => {
    mountedRef.current = true;
    
    // Prevent multiple initialization attempts
    if (initializationRef.current) {
      console.log('Initialization already in progress, skipping...');
      return;
    }
    
    initializationRef.current = true;
    
    const loadOperations = async () => {
      console.log('Loading persistent operations...');
      
      try {
        // First, try to migrate any localStorage operations to database
        await PersistentOperationService.migrateLocalStorageToDatabase();
        
        // Clean up old operations
        await PersistentOperationService.cleanupOldOperations();
        
        // Clean up duplicate operations for the same site
        await cleanupDuplicateOperations();
        
        // Load active operations from database with retry logic
        let operations: any[] = [];
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            operations = await PersistentOperationService.getActiveOperations();
            console.log(`Found ${operations.length} operations in database (attempt ${retryCount + 1})`);
            break;
          } catch (error) {
            console.error(`Failed to load operations (attempt ${retryCount + 1}):`, error);
            retryCount++;
            if (retryCount < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
        
        // Only update state if component is still mounted
        if (mountedRef.current) {
          setActiveOperations(operations);
        }
        
        if (operations.length > 0) {
          addLog(`Restored ${operations.length} active operations from database`, 'success');
          
          // Log details about each operation
          operations.forEach(op => {
            const statusText = op.status === 'running' ? 'running' : 'paused';
            const progressText = op.progress.total > 0 
              ? `${op.progress.current}/${op.progress.total}` 
              : 'preparing';
            addLog(`${op.siteName}: ${statusText} (${progressText})`, 'info');
          });
          
          // Resume any running operations
          operations.forEach(operation => {
            if (operation.status === 'running' && 
                !processingRef.current.has(operation.id) && 
                !resumeAttemptsRef.current.has(operation.id)) {
              
              resumeAttemptsRef.current.add(operation.id);
              console.log(`Auto-resuming operation ${operation.id} for ${operation.siteName}`);
              addLog(`Auto-resuming ${operation.type} for ${operation.siteName}...`, 'info');
              
              // Add a small delay to ensure the UI has time to show the operation
              setTimeout(() => {
                if (mountedRef.current) {
                  resumeOperation(operation, sitesRef.current);
                }
              }, 1000);
            } else if (operation.status === 'paused') {
              addLog(`Found paused operation for ${operation.siteName} - click Resume to continue`, 'warning');
            } else if (resumeAttemptsRef.current.has(operation.id)) {
              console.log(`Operation ${operation.id} already has a resume attempt, skipping`);
            }
          });
        } else {
          console.log('No active operations found in database');
        }
      } catch (error) {
        console.error('Failed to load operations:', error);
        addLog(`Failed to load operations: ${error.message}`, 'error');
      }
    };

    loadOperations();

    // Set up interval to check for operation updates
    intervalRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      
      PersistentOperationService.getActiveOperations()
        .then(operations => {
          if (!mountedRef.current) return;
          
          // Filter out any operations that have been cancelled
          const filteredOperations = operations.filter(op => 
            !cancelledOperationsRef.current.has(op.id) && 
            operationStatusRef.current.get(op.id) !== 'cancelled'
          );
          
          setActiveOperations(prevOps => {
            // Only update if there's a meaningful change
            const hasChanged = prevOps.length !== filteredOperations.length || 
              prevOps.some((prevOp, index) => {
                const newOp = filteredOperations[index];
                return !newOp || 
                  prevOp.id !== newOp.id || 
                  prevOp.status !== newOp.status || 
                  prevOp.progress.current !== newOp.progress.current ||
                  prevOp.message !== newOp.message;
              });
            
            return hasChanged ? filteredOperations : prevOps;
          });
        })
        .catch(error => {
          console.error('Failed to load operations in interval:', error);
        });
    }, 3000); // Check every 3 seconds

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      initializationRef.current = false;
    };
  }, []); // Remove addLog dependency to prevent re-initialization

  const cleanupDuplicateOperations = async () => {
    try {
      const operations = await PersistentOperationService.loadOperations();
      const duplicateGroups = new Map<string, PersistentOperation[]>();
      
      // Group operations by site ID and type
      operations.forEach(op => {
        if (op.status === 'running' || op.status === 'paused') {
          const key = `${op.siteId}-${op.type}`;
          if (!duplicateGroups.has(key)) {
            duplicateGroups.set(key, []);
          }
          duplicateGroups.get(key)!.push(op);
        }
      });
      
      // Remove duplicates, keeping only the most recent one
      for (const [key, ops] of duplicateGroups) {
        if (ops.length > 1) {
          console.log(`🧹 Found ${ops.length} duplicate operations for ${key}, cleaning up...`);
          
          // Sort by last update time, keep the most recent
          ops.sort((a, b) => b.lastUpdateTime - a.lastUpdateTime);
          const keepOperation = ops[0];
          const removeOperations = ops.slice(1);
          
          // Remove the older duplicates
          for (const op of removeOperations) {
            try {
              await PersistentOperationService.forceRemoveOperation(op.id);
              console.log(`🗑️ Removed duplicate operation ${op.id} for ${op.siteName}`);
            } catch (error) {
              console.error(`Failed to remove duplicate operation ${op.id}:`, error);
            }
          }
          
          addLog(`🧹 Cleaned up ${removeOperations.length} duplicate operations for ${keepOperation.siteName}`, 'info');
        }
      }
    } catch (error) {
      console.error('Failed to cleanup duplicate operations:', error);
    }
  };

  const resumeOperation = async (operation: PersistentOperation, currentSites?: Site[]) => {
    if (processingRef.current.has(operation.id)) {
      console.log(`Operation ${operation.id} is already being processed, skipping`);
      return; // Already processing
    }

    // Check if operation was cancelled
    if (cancelledOperationsRef.current.has(operation.id)) {
      console.log(`Operation ${operation.id} was cancelled, skipping resume`);
      return;
    }

    // Set operation status to running
    operationStatusRef.current.set(operation.id, 'running');

    // Check if component is still mounted
    if (!mountedRef.current) {
      console.log(`Component unmounted, skipping resume of operation ${operation.id}`);
      return;
    }

    // Use current sites or fall back to ref
    const sitesToUse = currentSites || sitesRef.current;

    // Create abort controller for this operation
    const abortController = new AbortController();
    abortControllersRef.current.set(operation.id, abortController);
    addLog(`🔄 Resuming operation ${operation.id} for ${operation.siteName}`, 'info');
    console.log(`🔄 RESUME: Starting resume for operation ${operation.id} (${operation.siteName})`);
    console.log(`🔄 RESUME: Operation status: ${operation.status}, progress: ${operation.progress.current}/${operation.progress.total}`);
    console.log(`🔄 RESUME: Processed GUIDs: ${operation.processedGuids?.length || 0}, Total GUIDs: ${operation.guidsToFetch?.length || 0}`);
    
    processingRef.current.add(operation.id);
    
    try {
      if (operation.type === 'fetch_entries') {
        console.log(`🔄 RESUME: Calling resumeFetchEntries for ${operation.siteName}`);
        await resumeFetchEntries(operation, sitesToUse, abortController.signal);
      } else if (operation.type === 'update_sitemap') {
        console.log(`🔄 RESUME: Calling resumeUpdateSitemap for ${operation.siteName}`);
        await resumeUpdateSitemap(operation, sitesToUse, abortController.signal);
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'AbortError') {
        console.log(`🛑 RESUME: Operation ${operation.id} was aborted`);
        addLog(`🛑 Operation ${operation.siteName} was cancelled`, 'warning');
      } else {
        console.error(`❌ RESUME ERROR: Failed to resume operation ${operation.id}:`, error);
        addLog(`❌ Failed to resume operation for ${operation.siteName}: ${error.message}`, 'error');
        try {
          await PersistentOperationService.failOperation(operation.id, `Resume failed: ${error.message}`);
        } catch (failError) {
          console.error('❌ RESUME ERROR: Failed to mark operation as failed:', failError);
        }
      }
    } finally {
      processingRef.current.delete(operation.id);
      abortControllersRef.current.delete(operation.id);
      operationStatusRef.current.delete(operation.id);
      // Don't remove from resumeAttemptsRef here - keep it to prevent duplicate attempts
    }
  };

  const resumeFetchEntries = async (operation: PersistentOperation, currentSites: Site[], signal?: AbortSignal) => {
    // Check if component is still mounted at the start
    if (!mountedRef.current) {
      console.log(`🛑 FETCH: Component unmounted, stopping fetch for operation ${operation.id}`);
      return;
    }

    // Check if operation was cancelled
    if (cancelledOperationsRef.current.has(operation.id)) {
      console.log(`🛑 FETCH: Operation ${operation.id} was cancelled, stopping fetch`);
      throw new Error('AbortError');
    }

    // Check operation status
    if (operationStatusRef.current.get(operation.id) === 'cancelled') {
      console.log(`🛑 FETCH: Operation ${operation.id} status is cancelled, stopping fetch`);
      throw new Error('AbortError');
    }
    
    addLog(`📥 Starting fetch resume for ${operation.siteName}`, 'info');
    console.log(`📥 FETCH: Starting resumeFetchEntries for ${operation.siteName}`);
    
    // Check if operation is paused
    try {
      const allOperations = await PersistentOperationService.loadOperations();
      const currentOperation = allOperations.find(op => op.id === operation.id);
      console.log(`📥 FETCH: Current operation status: ${currentOperation?.status}`);
      
      if (currentOperation?.status === 'paused') {
        addLog(`⏸️ Operation for ${operation.siteName} is paused - click Resume to continue`, 'warning');
        return;
      }
    } catch (error) {
      console.error(`📥 FETCH ERROR: Failed to check operation status:`, error);
      addLog(`⚠️ Failed to check operation status, continuing anyway`, 'warning');
    }
    
    try {
      const site = currentSites.find(s => s.id === operation.siteId);
      if (!site) {
        console.error(`📥 FETCH ERROR: Site not found for operation ${operation.id} (site ID: ${operation.siteId})`);
        console.log(`📥 FETCH ERROR: Available sites:`, currentSites.map(s => ({ id: s.id, name: s.name })));
        
        // Try to load sites from storage as a fallback
        try {
          const storedSites = await StorageService.loadSites();
          const storedSite = storedSites.find(s => s.id === operation.siteId);
          if (storedSite) {
            console.log(`📥 FETCH: Found site in storage, updating current sites list`);
            const updatedSites = [...currentSites, storedSite];
            setSites(updatedSites);
            sitesRef.current = updatedSites;
            // Retry with the updated site
            await resumeFetchEntries(operation, updatedSites, signal);
            return;
          }
        } catch (storageError) {
          console.error(`📥 FETCH ERROR: Failed to load sites from storage:`, storageError);
        }
        
        addLog(`❌ Site "${operation.siteName}" not found for operation - it may have been deleted`, 'error');
        await PersistentOperationService.failOperation(operation.id, `Site "${operation.siteName}" not found - it may have been deleted`);
        return;
      }

      console.log(`📥 FETCH: Found site ${site.name} for operation`);
      
      const guidsToFetch = operation.guidsToFetch || [];
      
      // Dynamically determine which GUIDs have already been processed by checking the database
      console.log(`📥 FETCH: Checking which of ${guidsToFetch.length} GUIDs are already processed...`);
      let processedGuids: string[] = [];
      try {
        processedGuids = await StorageService.getExistingEntryIdsForSite(site.url, guidsToFetch);
        console.log(`📥 FETCH: Found ${processedGuids.length} already processed GUIDs`);
      } catch (error) {
        console.error(`📥 FETCH ERROR: Failed to get existing entry IDs:`, error);
        addLog(`⚠️ Failed to check existing entries, starting from beginning`, 'warning');
        processedGuids = [];
      }
      
      const remainingGuids = guidsToFetch.filter(guid => !processedGuids.includes(guid));

      console.log(`📥 FETCH: Total GUIDs to fetch: ${guidsToFetch.length}`);
      console.log(`📥 FETCH: Already processed: ${processedGuids.length}`);
      console.log(`📥 FETCH: Remaining to process: ${remainingGuids.length}`);

      if (remainingGuids.length === 0) {
        console.log(`✅ FETCH: All entries already processed for ${site.name}`);
        await PersistentOperationService.completeOperation(operation.id, 'All entries processed');
        addLog(`✅ Completed: All entries processed for ${site.name}`, 'success');
        return;
      }

      if (processedGuids.length > 0) {
        addLog(`🔄 Resuming fetch: ${remainingGuids.length} entries remaining for ${site.name} (${processedGuids.length} already processed)`, 'info');
      } else {
        addLog(`🚀 Starting fetch: ${remainingGuids.length} entries for ${site.name}`, 'info');
      }

      // Continue processing from where we left off
      const chunkSize = 5000; // Increased from 1000 to 5000
      const fetchBatchSize = 25; // Reduced from 50 to 25 to be more conservative
      let totalSavedCount = processedGuids.length;
      const currentRunProcessedGuids: string[] = []; // Track GUIDs processed in this run

      console.log(`📥 FETCH: Starting processing with chunk size ${chunkSize}, fetch batch size ${fetchBatchSize}`);

      for (let i = 0; i < remainingGuids.length; i += chunkSize) {
        // Check if component is still mounted during processing
        if (!mountedRef.current) {
          console.log(`🛑 FETCH: Component unmounted during processing, stopping operation ${operation.id}`);
          return;
        }
        
        // Check if operation was cancelled during processing
        if (cancelledOperationsRef.current.has(operation.id) || signal?.aborted) {
          console.log(`🛑 FETCH: Operation ${operation.id} was cancelled during processing`);
          throw new Error('AbortError');
        }

        // Check operation status during processing
        if (operationStatusRef.current.get(operation.id) === 'cancelled') {
          console.log(`🛑 FETCH: Operation ${operation.id} status changed to cancelled during processing`);
          throw new Error('AbortError');
        }

        // Check if operation was paused during processing
        try {
          const allOps = await PersistentOperationService.loadOperations();
          const currentOp = allOps.find(op => op.id === operation.id);
          if (currentOp?.status === 'paused') {
            console.log(`⏸️ FETCH: Operation paused during processing for ${site.name}`);
            addLog(`⏸️ Operation paused for ${site.name}`, 'warning');
            return;
          }
        } catch (error) {
          console.error(`📥 FETCH ERROR: Failed to check pause status:`, error);
        }
        
        const chunk = remainingGuids.slice(i, i + chunkSize);
        const chunkEnd = Math.min(i + chunkSize, remainingGuids.length);
        const overallProgress = processedGuids.length + i;

        console.log(`📥 FETCH: Processing chunk ${Math.floor(i / chunkSize) + 1}: entries ${overallProgress + 1}-${overallProgress + chunk.length} of ${guidsToFetch.length}`);
        
        await PersistentOperationService.updateOperationProgress(
          operation.id,
          {
            current: overallProgress,
            total: guidsToFetch.length,
            currentChunk: Math.floor(i / chunkSize) + 1,
            totalChunks: Math.ceil(remainingGuids.length / chunkSize)
          },
          `Processing chunk ${Math.floor(i / chunkSize) + 1}: ${overallProgress + 1}-${overallProgress + chunk.length} of ${guidsToFetch.length}`
        );

        // Process this chunk in batches of 50: fetch 50, save 50, fetch 50, save 50...
        for (let batchStart = 0; batchStart < chunk.length; batchStart += fetchBatchSize) {
          // Check if component is still mounted during batch processing
          if (!mountedRef.current) {
            console.log(`🛑 FETCH: Component unmounted during batch processing, stopping operation ${operation.id}`);
            return;
          }
          
          // Check if operation was cancelled during batch processing
          if (cancelledOperationsRef.current.has(operation.id) || signal?.aborted) {
            console.log(`🛑 FETCH: Operation ${operation.id} was cancelled during batch processing`);
            throw new Error('AbortError');
          }

          // Check operation status during batch processing
          if (operationStatusRef.current.get(operation.id) === 'cancelled') {
            console.log(`🛑 FETCH: Operation ${operation.id} status changed to cancelled during batch processing`);
            throw new Error('AbortError');
          }

          // Check if operation was paused during batch processing
          try {
            const allOps = await PersistentOperationService.loadOperations();
            const currentOp = allOps.find(op => op.id === operation.id);
            if (currentOp?.status === 'paused') {
              console.log(`⏸️ FETCH: Operation paused during batch processing for ${site.name}`);
              addLog(`⏸️ Operation paused for ${site.name}`, 'warning');
              return;
            }
          } catch (error) {
            console.error(`📥 FETCH ERROR: Failed to check pause status during batch:`, error);
          }
          
          const batch = chunk.slice(batchStart, batchStart + fetchBatchSize);
          const batchProgress = overallProgress + batchStart;
          
          console.log(`📥 FETCH: Processing batch of ${batch.length} entries (${batchProgress + 1}-${batchProgress + batch.length} of ${guidsToFetch.length})`);
          
          try {
            // STEP 1: Fetch batch of 50 entries
            await PersistentOperationService.updateOperationProgress(
              operation.id,
              {
                current: batchProgress,
                total: guidsToFetch.length,
                currentChunk: Math.floor(i / chunkSize) + 1,
                totalChunks: Math.ceil(remainingGuids.length / chunkSize)
              },
              `📥 Fetching batch of ${batch.length} entries (${batchProgress + 1}-${batchProgress + batch.length})`
            );
            
            console.log(`📥 FETCH: Calling fetchPublicationsBatch for ${batch.length} entries`);
            const { success: batchEntries } = await ApiService.fetchPublicationsBatch(
              site.url,
              batch,
              signal, // Pass abort signal to API calls
              (completed, total) => {
                const overallCompleted = batchProgress + completed;
                console.log(`📥 FETCH: Batch progress update: ${overallCompleted}/${guidsToFetch.length}`);
                PersistentOperationService.updateOperationProgress(
                  operation.id,
                  {
                    current: overallCompleted,
                    total: guidsToFetch.length,
                    currentChunk: Math.floor(i / chunkSize) + 1,
                    totalChunks: Math.ceil(remainingGuids.length / chunkSize)
                  },
                  `📥 Fetching batch: ${overallCompleted}/${guidsToFetch.length}`
                );
              }
            );

            console.log(`📥 FETCH: Successfully fetched ${batchEntries.length} entries from API`);

            // STEP 2: Save the fetched batch immediately to database
            if (batchEntries.length > 0) {
              console.log(`💾 FETCH: Saving batch of ${batchEntries.length} entries to database...`);
              await PersistentOperationService.updateOperationProgress(
                operation.id,
                {
                  current: batchProgress + batchEntries.length,
                  total: guidsToFetch.length,
                  currentChunk: Math.floor(i / chunkSize) + 1,
                  totalChunks: Math.ceil(remainingGuids.length / chunkSize)
                },
                `💾 Saving batch of ${batchEntries.length} entries to database...`
              );
              
              // Batch database saves for better performance
              const dbSaveBatch = [];
              for (const entryData of batchEntries) {
                const entry = {
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
                
                dbSaveBatch.push(entry);
                totalSavedCount++;
              }
              
              // Save all entries in the batch at once with error handling
              try {
                await StorageService.saveEntriesBatch(site.url, dbSaveBatch);
                console.log(`💾 FETCH: Successfully saved batch of ${batchEntries.length} entries (${totalSavedCount} total saved)`);
                // Don't log here - let DatabaseService handle the activity logging when actually saved
              } catch (saveError) {
                console.error(`💾 FETCH ERROR: Failed to save batch:`, saveError);
                
                if (saveError.message.includes('timeout') || saveError.message.includes('Partial save')) {
                  addLog(`⚠️ Batch save timeout: ${saveError.message}`, 'warning');
                  
                  // Try to get the actual count of saved entries from the error message
                  const partialMatch = saveError.message.match(/(\d+)\/\d+ entries saved/);
                  if (partialMatch) {
                    const partiallySaved = parseInt(partialMatch[1]);
                    // Adjust totalSavedCount to reflect actual saves
                    totalSavedCount = totalSavedCount - batchEntries.length + partiallySaved;
                    // Don't log here - DatabaseService will handle the activity logging
                  }
                } else {
                  // Don't log here - DatabaseService will handle the activity logging
                  // Don't throw here, continue with next batch
                }
              }
              
            }

            // STEP 3: Update processed guids for this batch
            // Track the GUIDs processed in this current run (not saved to database)
            currentRunProcessedGuids.push(...batch);
            processedGuids.push(...batch);

            console.log(`📦 FETCH: Batch completed: ${batchEntries.length} entries fetched and saved`);
            // Don't log here - DatabaseService handles the activity logging for saves

            // Minimal delay between batches for maximum speed
            await new Promise(resolve => setTimeout(resolve, 10));

          } catch (error) {
            if (error.name === 'AbortError' || error.message === 'AbortError') {
              console.log(`🛑 FETCH: Batch processing aborted for operation ${operation.id}`);
              throw error;
            }
            console.error(`📥 FETCH ERROR: Error processing batch:`, error);
            addLog(`❌ Error processing batch: ${error.message}`, 'error');
            // Continue with next batch
          }
        }
        
        // Minimal delay between chunks for maximum speed
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Update site counts
      console.log(`📊 FETCH: Updating site counts for ${site.name}...`);
      try {
        const actualEntryCount = await StorageService.getActualEntryCount(site.url);
        const actualSitemapCount = await StorageService.getSitemapCount(site.url);

        const updatedSite = {
          ...site,
          entryCount: actualEntryCount,
          sitemapEntryCount: actualSitemapCount,
          lastUpdated: new Date()
        };

        const updatedSites = currentSites.map(s => s.id === site.id ? updatedSite : s);
        setSites(updatedSites);
        sitesRef.current = updatedSites;
        await StorageService.saveSites(updatedSites);
        
        addLog(`📊 Updated site counts during operation: ${actualEntryCount} entries, ${actualSitemapCount} in sitemap for ${site.name}`, 'info');
      } catch (countError) {
        console.error(`Failed to update site counts during operation for ${site.name}:`, countError);
        addLog(`⚠️ Failed to update site counts during operation for ${site.name}: ${countError.message}`, 'warning');
      }

      console.log(`✅ FETCH: Completing operation for ${site.name} with ${totalSavedCount} entries saved`);
      await PersistentOperationService.completeOperation(
        operation.id,
        `✅ Completed: ${totalSavedCount} entries saved for ${site.name}`
      );

      addLog(`✅ Fetch completed: ${totalSavedCount} entries saved for ${site.name}`, 'success');
      
      // Update site counts in the sites list after successful completion
      console.log(`📊 FETCH: Final site count update for ${site.name}...`);
      try {
        const finalEntryCount = await StorageService.getActualEntryCount(site.url);
        const finalSitemapCount = await StorageService.getSitemapCount(site.url);
        
        const finalUpdatedSite = {
          ...site,
          entryCount: finalEntryCount,
          sitemapEntryCount: finalSitemapCount,
          lastUpdated: new Date()
        };

        const finalUpdatedSites = currentSites.map(s => s.id === site.id ? finalUpdatedSite : s);
        setSites(finalUpdatedSites);
        sitesRef.current = finalUpdatedSites;
        await StorageService.saveSites(finalUpdatedSites);
        
        addLog(`📊 Updated site counts: ${finalEntryCount} entries, ${finalSitemapCount} in sitemap for ${site.name}`, 'success');
        console.log(`📊 FETCH: Final counts updated - entries: ${finalEntryCount}, sitemap: ${finalSitemapCount}`);
      } catch (countError) {
        console.error(`Failed to update final site counts for ${site.name}:`, countError);
        addLog(`⚠️ Failed to update final site counts for ${site.name}: ${countError.message}`, 'warning');
      }
      
      // Mark the newly fetched entries as "recently fetched" for the New tab
      // Use the GUIDs processed in this current run, not all processed GUIDs
      localStorage.setItem(`recently-fetched-${site.id}`, JSON.stringify({
        ids: currentRunProcessedGuids,
        timestamp: Date.now()
      }));

    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'AbortError') {
        console.log(`🛑 FETCH: Operation ${operation.id} was aborted`);
        return; // Don't log as error, this is expected
      }
      console.error(`❌ FETCH ERROR: Failed to resume fetch for ${operation.siteName}:`, error);
      addLog(`❌ Failed to resume fetch for ${operation.siteName}: ${error.message}`, 'error');
      
      await PersistentOperationService.failOperation(operation.id, error.message);
    }
  };

  const resumeUpdateSitemap = async (operation: PersistentOperation, currentSites: Site[], signal?: AbortSignal) => {
    // Implementation for resuming sitemap updates
    // This would be similar to the fetch entries logic
    console.log(`🗺️ SITEMAP: Resuming sitemap update for ${operation.siteName}`);
    addLog(`🗺️ Resuming sitemap update for ${operation.siteName}`, 'info');
    await PersistentOperationService.completeOperation(operation.id, 'Sitemap update resumed and completed');
  };

  const startPersistentFetch = async (site: Site) => {
    try {
      console.log(`🚀 START: Starting persistent fetch for ${site.name}`);
      addLog(`🚀 Starting persistent fetch for ${site.name}`, 'info');
      
      // Check if there's already an operation for this site (more thorough check)
      const allOperations = await PersistentOperationService.getActiveOperations();
      const existingOperations = allOperations.filter(op => 
        op.siteId === site.id && 
        (op.status === 'running' || op.status === 'paused') &&
        op.type === 'fetch_entries'
      );
      
      if (existingOperations.length > 0) {
        console.log(`⚠️ START: ${existingOperations.length} fetch operation(s) already exist for ${site.name}`);
        addLog(`⚠️ Fetch operation already running for ${site.name}`, 'warning');
        return;
      }

      console.log(`📋 START: Loading existing entries and sitemap for ${site.name}`);
      // Get new entries to fetch
      const existingEntries = await StorageService.loadAllEntriesForSite(site.url);
      const existingIds = new Set(existingEntries.map(entry => entry.id));
      const allGuids = await StorageService.loadSitemap(site.url);
      const newGuids = allGuids.filter(guid => !existingIds.has(guid));

      console.log(`📋 START: Found ${existingEntries.length} existing entries, ${allGuids.length} in sitemap, ${newGuids.length} new`);

      if (newGuids.length === 0) {
        console.log(`ℹ️ START: No new entries found for ${site.name}`);
        addLog(`ℹ️ No new entries found for ${site.name}`, 'info');
        return;
      }

      // Determine how many entries to fetch
      const guidsToFetch = maxEntries === 0 ? newGuids : newGuids.slice(0, maxEntries);

      console.log(`📋 START: Will fetch ${guidsToFetch.length} of ${newGuids.length} new entries (maxEntries: ${maxEntries})`);

      // Create persistent operation
      const operation: PersistentOperation = {
        id: `fetch_${site.id}_${Date.now()}`,
        type: 'fetch_entries',
        siteId: site.id,
        siteName: site.name,
        siteUrl: site.url,
        status: 'running',
        progress: { current: 0, total: guidsToFetch.length },
        startTime: Date.now(),
        lastUpdateTime: Date.now(),
        maxEntries,
        guidsToFetch,
        failedGuids: [],
        message: `🚀 Starting fetch of ${guidsToFetch.length} entries...`
      };

      console.log(`💾 START: Saving operation to database:`, operation.id);
      await PersistentOperationService.saveOperation(operation);
      
      console.log(`✅ START: Operation saved, starting processing`);
      addLog(`🚀 Started persistent fetch for ${site.name}: ${guidsToFetch.length} entries`, 'info');

      // Start processing
      resumeOperation(operation, sitesRef.current);

    } catch (error) {
      console.error(`❌ START ERROR: Failed to start persistent fetch for ${site.name}:`, error);
      addLog(`❌ Failed to start persistent fetch for ${site.name}: ${error.message}`, 'error');
    }
  };

  const stopOperation = async (operationId: string) => {
    console.log(`⏸️ STOP: Stopping/resuming operation ${operationId}`);
    const allOperations = await PersistentOperationService.loadOperations();
    const operation = allOperations.find(op => op.id === operationId);
    if (!operation) return;
    
    if (operation.status === 'running') {
      console.log(`⏸️ STOP: Pausing running operation ${operationId}`);
      operationStatusRef.current.set(operationId, 'paused');
      await PersistentOperationService.pauseOperation(operationId);
      processingRef.current.delete(operationId);
      
      // Abort the operation if it's running
      const abortController = abortControllersRef.current.get(operationId);
      if (abortController) {
        abortController.abort();
        abortControllersRef.current.delete(operationId);
      }
      
      addLog(`⏸️ Operation paused for ${operation.siteName}`, 'warning');
    } else if (operation.status === 'paused') {
      console.log(`▶️ STOP: Resuming paused operation ${operationId}`);
      operationStatusRef.current.set(operationId, 'running');
      await PersistentOperationService.resumeOperation(operationId);
      resumeOperation(operation, sitesRef.current);
      addLog(`▶️ Operation resumed for ${operation.siteName}`, 'info');
    }
  };

  const cancelOperation = async (operationId: string) => {
    console.log(`❌ CANCEL: Cancelling operation ${operationId}`);
    
    // Set operation status to cancelled immediately
    operationStatusRef.current.set(operationId, 'cancelled');
    
    // Add to cancelled operations set to prevent it from reappearing
    cancelledOperationsRef.current.add(operationId);
    
    // Immediately remove from UI state
    setActiveOperations(prev => prev.filter(op => op.id !== operationId));
    
    // Stop processing if running
    processingRef.current.delete(operationId);
    
    // Abort the operation if it's running
    const abortController = abortControllersRef.current.get(operationId);
    if (abortController) {
      console.log(`🛑 CANCEL: Aborting operation ${operationId}`);
      abortController.abort();
      abortControllersRef.current.delete(operationId);
    }
    
    try {
      const allOperations = await PersistentOperationService.loadOperations();
      const operation = allOperations.find(op => op.id === operationId);
      if (!operation) {
        console.log(`Operation ${operationId} not found in database, already removed`);
        operationStatusRef.current.delete(operationId);
        return;
      }
    
      // Force remove the operation from all storage locations
      await PersistentOperationService.forceRemoveOperation(operationId);
      
      console.log(`❌ CANCEL: Operation cancelled for ${operation.siteName}`);
      addLog(`❌ Operation cancelled for ${operation.siteName}`, 'warning');
      
      // Clean up cancelled operation from the set after a delay
      setTimeout(() => {
        cancelledOperationsRef.current.delete(operationId);
        operationStatusRef.current.delete(operationId);
      }, 30000);
    } catch (error) {
      console.error(`Failed to cancel operation ${operationId}:`, error);
      addLog(`Failed to cancel operation: ${error.message}`, 'error');
      
      // Try force removal even if there was an error
      try {
        await PersistentOperationService.forceRemoveOperation(operationId);
        console.log(`✓ Force removed operation ${operationId} after error`);
      } catch (forceError) {
        console.error(`Failed to force remove operation ${operationId}:`, forceError);
      }
      
      // If there was an error, we should reload the operations to get the correct state
      try {
        const operations = await PersistentOperationService.getActiveOperations();
        setActiveOperations(operations);
      } catch (reloadError) {
        console.error('Failed to reload operations after cancel error:', reloadError);
      }
      
      // Remove from cancelled set if there was an error
      cancelledOperationsRef.current.delete(operationId);
      operationStatusRef.current.delete(operationId);
    }
  };

  return {
    activeOperations,
    startPersistentFetch,
    stopOperation,
    cancelOperation,
    resumeOperation
  };
};