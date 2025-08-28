import { RETRY_CONFIG } from './constants';

export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = RETRY_CONFIG.maxRetries,
  onTimeout?: (attempt: number, maxRetries: number) => void,
  onError?: (error: Error) => void
): Promise<T> {
  let lastError: Error | null = null;
  let consecutiveTimeouts = 0;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      
      // Reset timeout counter on success
      consecutiveTimeouts = 0;
      return result;
    } catch (error) {
      lastError = error as Error;
      
      if (error.message && (error.message.includes('timeout') || error.message.includes('Failed to fetch'))) {
        consecutiveTimeouts++;
        const errorType = error.message.includes('timeout') ? 'timeout' : 'fetch failure';
        console.warn(`⏱️ ${operationName} ${errorType} (attempt ${attempt}/${maxRetries}, consecutive failures: ${consecutiveTimeouts}):`, error.message);
        
        if (onTimeout && attempt === 1) {
          onTimeout(attempt, maxRetries);
        }
        
        if (attempt < maxRetries) {
          // Exponential backoff with jitter
          const baseDelay = RETRY_CONFIG.retryDelayBase * Math.pow(2, attempt - 1);
          const jitter = Math.random() * 1000; // Add up to 1 second of jitter
          const delay = baseDelay + jitter;
          
          console.log(`⏳ Retrying ${operationName} in ${Math.round(delay)}ms... (${errorType})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      } else {
        console.error(`❌ Non-retriable error in ${operationName}:`, error);
        if (onError) {
          onError(error);
        }
        break; // Don't retry non-retriable errors
      }
    }
  }
  
  console.error(`💥 ${operationName} failed after ${maxRetries} attempts:`, lastError);
  throw lastError || new Error(`${operationName} failed after ${maxRetries} attempts`);
}

export async function withProgressRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  onTimeout?: (attempt: number, maxRetries: number) => void
): Promise<T> {
  const maxProgressRetries = 2; // Fewer retries for progress updates
  
  return withRetry(
    operation,
    operationName,
    maxProgressRetries,
    onTimeout,
    (error) => {
      console.error(`❌ Non-timeout error in ${operationName}:`, error);
    }
  );
}