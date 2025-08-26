import { SupabaseClient } from '@supabase/supabase-js';
import { Entry } from '../../types';
import { getTableName, BATCH_CONFIG } from './constants';

export class EntriesBatchRepository {
  constructor(private supabase: SupabaseClient) {}

  async saveEntry(entry: Entry, siteId: string): Promise<void> {
    try {
      const tableName = getTableName('entries');
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database operation timeout')), BATCH_CONFIG.timeout);
      });
      
      const operationPromise = this.supabase
        .from(tableName)
        .upsert({
          id: entry.id,
          site_id: siteId,
          title: entry.title,
          abstract: entry.abstract || '',
          body: entry.body || '',
          published_date: entry.publishedDate,
          type: entry.type || 'publication',
          seen: entry.seen || false,
          metadata: entry.metadata || {}
        });

      const { error } = await Promise.race([operationPromise, timeoutPromise]);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Failed to save entry to database:', error);
      throw error;
    }
  }

  async saveEntriesBatch(entries: Entry[], siteId: string): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    try {
      const tableName = getTableName('entries');
      
      // Prepare batch data
      const batchData = entries.map(entry => ({
        id: entry.id,
        site_id: siteId,
        title: entry.title,
        abstract: entry.abstract || '',
        body: entry.body || '',
        published_date: entry.publishedDate,
        type: entry.type || 'publication',
        seen: entry.seen || false,
        metadata: entry.metadata || {}
      }));

      // Process in even smaller chunks to avoid statement timeout
      const chunkSize = BATCH_CONFIG.chunkSize;
      let processedCount = 0;
      
      for (let i = 0; i < batchData.length; i += chunkSize) {
        const chunk = batchData.slice(i, i + chunkSize);
        
        // Add shorter timeout handling for each chunk
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Database insert timeout')), BATCH_CONFIG.timeout);
        });
        
        const insertPromise = this.supabase
          .from(tableName)
          .upsert(chunk, {
            onConflict: 'id',
            ignoreDuplicates: false
          });
        
        const { error } = await Promise.race([insertPromise, timeoutPromise]);

        if (error) {
          console.error(`Database error for chunk ${i}-${i + chunk.length}:`, error);
          throw error;
        }
        
        processedCount += chunk.length;
        console.log(`Processed ${processedCount}/${batchData.length} entries (${Math.round((processedCount / batchData.length) * 100)}%)`);
        
        // Only log to activity if entries were actually saved to database
        const addLog = (window as any).addLog;
        if (addLog && processedCount > 0) {
          addLog(`💾 Saved batch of ${chunk.length} entries (${processedCount} total saved)`, 'info');
        }
        
        // Longer delay between chunks to avoid overwhelming the database
        if (i + chunkSize < batchData.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_CONFIG.delayBetweenChunks));
        }
      }

      console.log(`Successfully batch saved ${entries.length} entries to database`);
    } catch (error) {
      if (error.message === 'Database insert timeout') {
        console.error('Database insert timed out - entries may be partially saved');
        throw new Error(`Partial save completed: entries saved due to timeout`);
      } else if (error.message && error.message.includes('statement timeout')) {
        console.error('Database statement timeout - reducing batch size and retrying...');
        // Try with even smaller batches
        return this.saveEntriesBatchWithRetry(entries, siteId, 25);
      } else {
        console.error('Failed to batch save entries to database:', error);
        throw error;
      }
    }
  }

  private async saveEntriesBatchWithRetry(entries: Entry[], siteId: string, chunkSize: number): Promise<void> {
    console.log(`Retrying batch save with smaller chunk size: ${chunkSize}`);

    try {
      const tableName = getTableName('entries');
      
      // Prepare batch data
      const batchData = entries.map(entry => ({
        id: entry.id,
        site_id: siteId,
        title: entry.title,
        abstract: entry.abstract || '',
        body: entry.body || '',
        published_date: entry.publishedDate,
        type: entry.type || 'publication',
        seen: entry.seen || false,
        metadata: entry.metadata || {}
      }));

      let processedCount = 0;
      let failedChunks = 0;
      
      for (let i = 0; i < batchData.length; i += chunkSize) {
        const chunk = batchData.slice(i, i + chunkSize);
        
        try {
          // Shorter timeout for retry attempts
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Retry timeout')), 10000); // 10 second timeout
          });
          
          const insertPromise = this.supabase
            .from(tableName)
            .upsert(chunk, {
              onConflict: 'id',
              ignoreDuplicates: false
            });
          
          const { error } = await Promise.race([insertPromise, timeoutPromise]);

          if (error) {
            console.error(`Retry failed for chunk ${i}-${i + chunk.length}:`, error);
            failedChunks++;
            // Continue with next chunk instead of failing completely
          } else {
            processedCount += chunk.length;
            
            // Only log to activity when actually saved to database
            const addLog = (window as any).addLog;
            if (addLog) {
              addLog(`💾 Saved batch of ${chunk.length} entries (${processedCount} total saved)`, 'info');
            }
          }
        } catch (chunkError) {
          console.error(`Chunk ${i}-${i + chunk.length} failed:`, chunkError);
          failedChunks++;
          // Continue with next chunk
        }
        
        console.log(`Retry progress: ${processedCount}/${batchData.length} entries saved, ${failedChunks} chunks failed`);
        
        // Even longer delay between retry chunks
        if (i + chunkSize < batchData.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (failedChunks > 0) {
        console.warn(`Batch save completed with ${failedChunks} failed chunks. ${processedCount}/${entries.length} entries saved.`);
        
        // Only throw error with activity log if there were actual saves
        const addLog = (window as any).addLog;
        if (addLog && processedCount > 0) {
          addLog(`⚠️ Partial save completed: ${processedCount}/${entries.length} entries saved, ${failedChunks} chunks failed`, 'warning');
        }
        
        throw new Error(`Partial save completed: ${processedCount}/${entries.length} entries saved, ${failedChunks} chunks failed`);
      }

      console.log(`Retry successful: ${processedCount} entries saved to database`);
      
      // Log successful retry to activity
      const addLog = (window as any).addLog;
      if (addLog && processedCount > 0) {
        addLog(`✅ Retry successful: ${processedCount} entries saved to database`, 'success');
      }
    } catch (error) {
      console.error('Retry batch save failed:', error);
      throw error;
    }
  }

  async deleteEntry(entryId: string): Promise<void> {
    try {
      const tableName = getTableName('entries');
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database operation timeout')), BATCH_CONFIG.timeout);
      });
      
      const operationPromise = this.supabase
        .from(tableName)
        .delete()
        .eq('id', entryId);

      const { error } = await Promise.race([operationPromise, timeoutPromise]);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Failed to delete entry from database:', error);
      throw error;
    }
  }

  async deleteAllEntries(siteId: string): Promise<void> {
    try {
      const tableName = getTableName('entries');
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database operation timeout')), BATCH_CONFIG.timeout);
      });
      
      const operationPromise = this.supabase
        .from(tableName)
        .delete()
        .eq('site_id', siteId);

      const { error } = await Promise.race([operationPromise, timeoutPromise]);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Failed to delete entries from database:', error);
      throw error;
    }
  }
}