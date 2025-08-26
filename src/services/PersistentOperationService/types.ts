export interface PersistentOperation {
  id: string;
  type: 'fetch_entries' | 'update_sitemap' | 'bulk_fetch' | 'bulk_sitemap';
  siteId: string;
  siteName: string;
  siteUrl: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  progress: {
    current: number;
    total: number;
    currentChunk?: number;
    totalChunks?: number;
  };
  startTime: number;
  lastUpdateTime: number;
  maxEntries?: number;
  guidsToFetch?: string[];
  failedGuids?: string[];
  message: string;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelayBase: number;
  operationTimeout: number;
  cleanupTimeout: number;
}