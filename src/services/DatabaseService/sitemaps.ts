import { SupabaseClient } from '@supabase/supabase-js';
import { getTableName, DEFAULT_QUERY_OPTIONS, BATCH_CONFIG } from './constants';

export class SitemapsRepository {
  constructor(private supabase: SupabaseClient) {}

  async getSitemapCount(siteId: string, siteName: string): Promise<number> {
    try {
      const tableName = getTableName('sitemaps');
      
      console.log(`📊 Querying sitemap count for site ${siteName} (ID: ${siteId}) from table ${tableName}`);
      
      // Add timeout to the query
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Sitemap count query timeout')), 30000);
      });
      
      const queryPromise = this.supabase
        .from(tableName)
        .select('guid', { count: 'exact', head: true })
        .eq('site_id', siteId);

      const { count, error } = await Promise.race([queryPromise, timeoutPromise]);

      if (error) {
        console.error(`📊 Error getting sitemap count for ${siteName}:`, error);
        console.warn(`📊 ⚠️ SITEMAP COUNT SET TO 0: Database error for ${siteName}: ${error.message}`);
        throw error;
      }

      console.log(`📊 Sitemap count query result for ${siteName}: ${count || 0}`);
      
      if ((count || 0) === 0) {
        console.warn(`📊 ⚠️ SITEMAP COUNT IS 0: Database returned 0 sitemap entries for ${siteName} (site_id: ${siteId}) from table ${tableName}`);
        
        // Try to get a sample of actual records to debug
        try {
          // Also check if there are any records at all in the sitemaps table
          const { count: totalCount } = await this.supabase
            .from(tableName)
            .select('guid', { count: 'exact', head: true });
            
          console.log(`📊 Total records in ${tableName} table: ${totalCount || 0}`);
          
          const { data: sampleData, error: sampleError } = await this.supabase
            .from(tableName)
            .select('guid')
            .eq('site_id', siteId)
            .limit(5);
            
          if (!sampleError && sampleData) {
            console.log(`📊 Sample sitemap records for ${siteName}:`, sampleData);
            if (sampleData.length > 0) {
              console.error(`📊 INCONSISTENCY: Found ${sampleData.length} sample records but count returned 0`);
            }
          } else if (sampleError) {
            console.warn(`📊 Sample query error:`, sampleError);
          }
        } catch (debugError) {
          console.warn(`📊 Could not fetch sample records for debugging:`, debugError);
        }
      }
      
      return count || 0;
    } catch (error) {
      if (error.message === 'Sitemap count query timeout') {
        console.error('📊 Sitemap count query timed out after 10 seconds');
        console.warn(`📊 ⚠️ SITEMAP COUNT SET TO 0: Query timeout for sitemap`);
        return 0;
      }
      console.error('📊 Failed to get sitemap count from database:', error);
      console.warn(`📊 ⚠️ SITEMAP COUNT SET TO 0: Exception occurred: ${error.message}`);
      throw error;
    }
  }

  async loadSitemap(siteId: string): Promise<string[]> {
    try {
      const tableName = getTableName('sitemaps');

      // Load all sitemap entries without limit
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      
      while (true) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Sitemap load timeout')), 30000);
        });
        
        const queryPromise = this.supabase
          .from(tableName)
          .select('guid')
          .eq('site_id', siteId)
          .order('created_at', { ascending: true })
          .range(from, from + batchSize - 1);

        const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) {
          break;
        }

        allData.push(...data);
        
        // If we got less than the batch size, we've reached the end
        if (data.length < batchSize) {
          break;
        }
        
        from += batchSize;
      }

      return allData.map(item => item.guid);
    } catch (error) {
      console.error('Failed to load sitemap from database:', error);
      throw error;
    }
  }

  async saveSitemap(siteId: string, siteName: string, guids: string[]): Promise<void> {
    try {
      const tableName = getTableName('sitemaps');

      // Clear existing sitemap entries for this site
      console.log(`Clearing existing sitemap entries for site ${siteId}`);
      
      const deleteTimeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database delete timeout')), 30000);
      });
      
      const deletePromise = this.supabase
        .from(tableName)
        .delete()
        .eq('site_id', siteId);

      const { error: deleteError } = await Promise.race([deletePromise, deleteTimeoutPromise]);

      if (deleteError) {
        console.error(`Error clearing existing sitemap entries:`, deleteError);
        throw deleteError;
      }

      console.log(`Cleared existing sitemap entries, now inserting ${guids.length} new entries`);
      
      // Insert new sitemap entries
      if (guids.length > 0) {
        // Insert in batches to avoid potential size limits
        const batchSize = 500; // Reduced batch size for better reliability
        let totalInserted = 0;
        
        for (let i = 0; i < guids.length; i += batchSize) {
          const batch = guids.slice(i, i + batchSize);
          const sitemapEntries = batch.map(guid => ({
            site_id: siteId,
            guid: guid
          }));

          const insertTimeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Database insert timeout')), 30000);
          });
          
          const insertPromise = this.supabase
            .from(tableName)
            .insert(sitemapEntries);

          const { error } = await Promise.race([insertPromise, insertTimeoutPromise]);

          if (error) {
            console.error(`Error inserting sitemap batch ${i}-${i + batch.length}:`, error);
            throw error;
          }
          
          totalInserted += batch.length;
          console.log(`Inserted batch ${i}-${i + batch.length}, total inserted: ${totalInserted}`);
          
          // Small delay between batches to avoid overwhelming the database
          if (i + batchSize < guids.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        console.log(`Successfully inserted all ${totalInserted} sitemap entries for site ${siteName}`);
      }
      
      console.log(`Successfully saved ${guids.length} sitemap entries for site ${siteId}`);
      
      // Wait longer for database consistency
      await new Promise(resolve => setTimeout(resolve, 1500));
      
    } catch (error) {
      console.error('Failed to save sitemap to database:', error);
      throw error;
    }
  }
}