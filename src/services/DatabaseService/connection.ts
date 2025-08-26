import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DatabaseConfig } from './types';
import { CONNECTION_TEST_TIMEOUT, getTableName } from './constants';

export class DatabaseConnection {
  private supabase: SupabaseClient | null = null;
  private available = false;

  constructor() {
    this.initializeSupabase();
  }

  private initializeSupabase() {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseKey && supabaseUrl.trim() !== '' && supabaseKey.trim() !== '') {
        // Validate URL format before attempting to create client
        try {
          new URL(supabaseUrl);
        } catch (urlError) {
          console.warn('Invalid Supabase URL format:', supabaseUrl);
          this.available = false;
          return;
        }
        
        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.available = true;
        console.log('Supabase client initialized successfully');
      } else {
        console.warn('Supabase credentials not found or empty in environment variables');
        this.available = false;
      }
    } catch (error) {
      console.error('Failed to initialize Supabase client:', error);
      this.available = false;
    }
  }

  isAvailable(): boolean {
    return this.available && this.supabase !== null;
  }

  getStorageType(): 'database' | 'local' {
    return this.isAvailable() ? 'database' : 'local';
  }

  getSupabaseClient(): SupabaseClient | null {
    return this.supabase;
  }

  async testConnection(): Promise<void> {
    if (!this.supabase) {
      throw new Error('Supabase client not initialized');
    }

    try {
      // Perform a simple query to test the connection
      const tableName = getTableName('sites');
      
      // Create a promise that will timeout after 5 seconds
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Database query timeout')), CONNECTION_TEST_TIMEOUT);
      });
      
      // Create the database query promise
      const queryPromise = this.supabase
        .from(tableName)
        .select('id')
        .limit(1);
      
      // Race the query against the timeout
      const { error } = await Promise.race([queryPromise, timeoutPromise]);

      if (error) {
        throw new Error(`Database query failed: ${error.message}`);
      }
    } catch (error) {
      if (error.message === 'Database query timeout') {
        throw new Error('Database query timed out after 5 seconds');
      }
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }
}