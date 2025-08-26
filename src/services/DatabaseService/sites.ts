import { SupabaseClient } from '@supabase/supabase-js';
import { Site } from '../../types';
import { getTableName, DEFAULT_QUERY_OPTIONS } from './constants';

export class SitesRepository {
  constructor(private supabase: SupabaseClient) {}

  async loadSites(): Promise<Site[]> {
    try {
      const tableName = getTableName('sites');
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database query timeout')), DEFAULT_QUERY_OPTIONS.timeout);
      });
      
      const queryPromise = this.supabase
        .from(tableName)
        .select('*')
        .order('created_at', { ascending: false });

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

      if (error) {
        throw error;
      }

      return (data || []).map(site => ({
        id: site.id,
        url: site.url,
        name: site.name,
        lastUpdated: new Date(site.last_updated),
        entryCount: site.entry_count || 0,
        sitemapEntryCount: site.sitemap_entry_count || 0
      }));
    } catch (error) {
      console.error('Failed to load sites from database:', error);
      throw error;
    }
  }

  async saveSite(site: Site): Promise<void> {
    try {
      const tableName = getTableName('sites');
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database operation timeout')), DEFAULT_QUERY_OPTIONS.timeout);
      });
      
      const operationPromise = this.supabase
        .from(tableName)
        .upsert({
          id: site.id,
          url: site.url,
          name: site.name,
          last_updated: site.lastUpdated.toISOString(),
          entry_count: site.entryCount || 0,
          sitemap_entry_count: site.sitemapEntryCount || 0
        });

      const { error } = await Promise.race([operationPromise, timeoutPromise]);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Failed to save site to database:', error);
      throw error;
    }
  }

  async getSiteByUrl(url: string): Promise<Site | null> {
    try {
      const tableName = getTableName('sites');
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database query timeout')), DEFAULT_QUERY_OPTIONS.timeout);
      });
      
      const queryPromise = this.supabase
        .from(tableName)
        .select('*')
        .eq('url', url)
        .single();

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        throw error;
      }

      if (!data) {
        return null;
      }

      return {
        id: data.id,
        url: data.url,
        name: data.name,
        lastUpdated: new Date(data.last_updated),
        entryCount: data.entry_count || 0,
        sitemapEntryCount: data.sitemap_entry_count || 0
      };
    } catch (error) {
      console.error('Failed to get site by URL from database:', error);
      throw error;
    }
  }

  async deleteSite(siteId: string): Promise<void> {
    try {
      const tableName = getTableName('sites');
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database operation timeout')), DEFAULT_QUERY_OPTIONS.timeout);
      });
      
      const operationPromise = this.supabase
        .from(tableName)
        .delete()
        .eq('id', siteId);

      const { error } = await Promise.race([operationPromise, timeoutPromise]);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Failed to delete site from database:', error);
      throw error;
    }
  }
}