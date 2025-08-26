import { RetryConfig } from './types';

export const RETRY_CONFIG: RetryConfig = {
  maxRetries: 3, // Reduced from 5 to 3
  retryDelayBase: 2000, // Increased to 2 seconds
  operationTimeout: 30000, // Increased to 30 seconds
  cleanupTimeout: 30000, // 30 seconds for cleanup operations
};

export const OPERATIONS_KEY = 'knowledge-updater-operations';

export const getTableName = (): string => {
  const environment = import.meta.env.VITE_ENVIRONMENT || 'development';
  const prefix = environment === 'development' ? 'dev_' : '';
  return `${prefix}persistent_operations`;
};