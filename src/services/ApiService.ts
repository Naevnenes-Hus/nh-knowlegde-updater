import { HtmlCleaner } from '../utils/htmlCleaner';

export class ApiService {
  private static readonly BASE_DELAY = 10; // Reduced from 50ms to 10ms
  private static readonly MAX_DELAY = 30000;
  private static readonly MAX_RETRIES = 3;
  private static readonly CONCURRENT_REQUESTS = 100; // Increased from 24 to 100
  private static failureCounts = new Map<string, number>();
  private static circuitBreakers = new Map<string, boolean>();

  private static async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static getBackoffDelay(attempt: number): number {
    return Math.min(this.BASE_DELAY * Math.pow(2, attempt), this.MAX_DELAY);
  }

  private static isCircuitBreakerOpen(domain: string): boolean {
    return this.circuitBreakers.get(domain) || false;
  }

  private static openCircuitBreaker(domain: string): void {
    this.circuitBreakers.set(domain, true);
    setTimeout(() => {
      this.circuitBreakers.set(domain, false);
      this.failureCounts.set(domain, 0);
    }, 5 * 60 * 1000);
  }

  private static recordFailure(domain: string): void {
    const failures = (this.failureCounts.get(domain) || 0) + 1;
    this.failureCounts.set(domain, failures);
    
    if (failures >= 5) {
      this.openCircuitBreaker(domain);
    }
  }

  private static recordSuccess(domain: string): void {
    this.failureCounts.set(domain, 0);
  }

  private static getDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  static async fetchWithRetry(
    url: string, 
    options: RequestInit = {}, 
    signal?: AbortSignal
  ): Promise<Response> {
    const domain = this.getDomain(url);
    
    if (this.isCircuitBreakerOpen(domain)) {
      throw new Error(`Circuit breaker open for ${domain} - too many failures`);
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        if (signal?.aborted) {
          throw new Error('AbortError');
        }

        const response = await fetch(url, {
          ...options,
          signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeUpdater/1.0)',
            ...options.headers,
          },
        });

        if (response.ok) {
          this.recordSuccess(domain);
          return response;
        }

        if (response.status === 403 || response.status === 429) {
          this.recordFailure(domain);
          throw new Error(`Rate limited (${response.status})`);
        }

        if (response.status === 404) {
          throw new Error('Not found (404)');
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        
      } catch (error) {
        lastError = error as Error;
        
        if (error.name === 'AbortError' || lastError.message === 'AbortError') {
          throw error;
        }

        if (lastError.message.includes('Rate limited') || 
            lastError.message.includes('403') || 
            lastError.message.includes('429')) {
          this.recordFailure(domain);
          throw error;
        }

        if (attempt < this.MAX_RETRIES - 1) {
          const delayMs = this.getBackoffDelay(attempt);
          await this.delay(delayMs);
        } else {
          this.recordFailure(domain);
        }
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  static async fetchSitemap(siteUrl: string, signal?: AbortSignal): Promise<string[]> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing. Please check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.');
    }
    
    const proxyUrl = `${supabaseUrl}/functions/v1/sitemap-proxy?url=${encodeURIComponent(siteUrl)}`;
    
    try {
      // Test if Edge Function is accessible first
      const testResponse = await fetch(`${supabaseUrl}/functions/v1/sitemap-proxy`, {
        method: 'OPTIONS',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
        }
      });
      
      if (!testResponse.ok) {
        console.error('Sitemap Edge Function not accessible:', testResponse.status, testResponse.statusText);
        throw new Error(`Sitemap Edge Function not accessible: ${testResponse.status} ${testResponse.statusText}`);
      }
      
      const response = await this.fetchWithRetry(proxyUrl, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        }
      }, signal);
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(`Proxy error: ${data.error}`);
      }
      
      return data.guids || [];
    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'AbortError') {
        throw error;
      }
      
      // More specific error messages
      if (error.message.includes('Failed to fetch')) {
        throw new Error(`Network error: Unable to connect to Sitemap Edge Function. Please check your internet connection and Supabase configuration.`);
      }
      
      if (error.message.includes('not accessible')) {
        throw new Error(`Sitemap Edge Function deployment issue: ${error.message}`);
      }
      
      throw new Error(`Sitemap fetch error: ${error.message}`);
    }
  }

  static async fetchPublicationsBatch(
    siteUrl: string, 
    guids: string[], 
    signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => void
  ): Promise<{ success: any[], failed: string[] }> {
    console.log(`Starting batch fetch for ${guids.length} publications from ${siteUrl}`);
    
    const results: any[] = [];
    const failed: string[] = [];
    let completed = 0;
    
    for (let i = 0; i < guids.length; i += this.CONCURRENT_REQUESTS) {
      if (signal?.aborted) {
        console.log(`Batch fetch aborted after ${completed} entries`);
        throw new Error('AbortError');
      }
      
      const batch = guids.slice(i, i + this.CONCURRENT_REQUESTS);
      console.log(`Processing batch ${Math.floor(i / this.CONCURRENT_REQUESTS) + 1}: ${batch.length} entries`);
      
      const batchPromises = batch.map(async (guid) => {
        // Check for abort signal before each individual fetch
        if (signal?.aborted) {
          throw new Error('AbortError');
        }
        
        try {
          const data = await this.fetchPublication(siteUrl, guid, signal);
          return { success: true, data, guid };
        } catch (error) {
          if (error.name === 'AbortError' || error.message === 'AbortError') {
            throw error; // Re-throw abort errors to stop the entire batch
          }
          return { success: false, error: error.message, guid };
        }
      });
      
      try {
        const batchResults = await Promise.allSettled(batchPromises);
        
        // Check if any promise was rejected due to abort
        const abortedPromise = batchResults.find(result => 
          result.status === 'rejected' && 
          (result.reason?.name === 'AbortError' || result.reason?.message === 'AbortError')
        );
        
        if (abortedPromise) {
          console.log(`Batch processing aborted`);
          throw new Error('AbortError');
        }
      
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            if (result.value.success) {
              results.push(result.value.data);
            } else {
              failed.push(result.value.guid);
            }
          } else {
            const guid = batch[batchResults.indexOf(result)];
            failed.push(guid);
          }
          
          completed++;
          onProgress?.(completed, guids.length);
        }
      } catch (error) {
        if (error.name === 'AbortError' || error.message === 'AbortError') {
          throw error;
        }
        // For other errors, continue processing
        console.error('Batch processing error:', error);
      }
      
      console.log(`Batch completed: ${results.length} successful, ${failed.length} failed so far`);
      
      if (i + this.CONCURRENT_REQUESTS < guids.length) {
        // Check for abort before delay
        if (signal?.aborted) {
          throw new Error('AbortError');
        }
        await this.delay(25); // Reduced from 200ms to 25ms
      }
    }
    
    console.log(`Batch fetch completed: ${results.length} successful, ${failed.length} failed total`);
    return { success: results, failed };
  }

  static async fetchPublication(siteUrl: string, guid: string, signal?: AbortSignal): Promise<any> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing. Please check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.');
    }
    
    const proxyUrl = `${supabaseUrl}/functions/v1/publication-proxy?url=${encodeURIComponent(siteUrl)}&guid=${encodeURIComponent(guid)}`;
    
    try {
      // Test if Edge Function is accessible first
      const testResponse = await fetch(`${supabaseUrl}/functions/v1/publication-proxy`, {
        method: 'OPTIONS',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
        }
      });
      
      if (!testResponse.ok) {
        console.error('Edge Function not accessible:', testResponse.status, testResponse.statusText);
        throw new Error(`Edge Function not accessible: ${testResponse.status} ${testResponse.statusText}`);
      }
      
      const response = await this.fetchWithRetry(proxyUrl, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        }
      }, signal);
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(`Proxy error: ${data.error}`);
      }
      
      return HtmlCleaner.cleanObject(data);
    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'AbortError') {
        throw error;
      }
      
      // More specific error messages
      if (error.message.includes('Failed to fetch')) {
        throw new Error(`Network error: Unable to connect to Edge Function. Please check your internet connection and Supabase configuration.`);
      }
      
      if (error.message.includes('not accessible')) {
        throw new Error(`Edge Function deployment issue: ${error.message}`);
      }
      
      throw new Error(`Publication fetch error: ${error.message}`);
    }
  }
}