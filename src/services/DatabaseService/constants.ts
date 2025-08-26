import { BatchConfig, QueryOptions } from './types';

export const DEFAULT_QUERY_OPTIONS: QueryOptions = {
  timeout: 30000, // Reduced to 30 seconds for better reliability
  retries: 3,
};

export const BATCH_CONFIG: BatchConfig = {
  chunkSize: 100, // Smaller chunks for better reliability
  delayBetweenChunks: 500, // Longer delays for database stability
  timeout: 30000, // Consistent 30 second timeout
};

export const CONNECTION_TEST_TIMEOUT = 10000;

export function getTableName(baseName: string): string {
  const environment = import.meta.env.VITE_ENVIRONMENT || 'development';
  const prefix = environment === 'development' ? 'dev_' : '';
  return `${prefix}${baseName}`;
}