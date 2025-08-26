import { PersistentOperation } from './types';
import { OPERATIONS_KEY } from './constants';

export function loadOperationsFromLocal(): PersistentOperation[] {
  try {
    const data = localStorage.getItem(OPERATIONS_KEY);
    const operations = data ? JSON.parse(data) : [];
    if (operations.length > 0) {
      console.log(`💾 Loaded ${operations.length} operations from localStorage`);
    }
    return operations;
  } catch (error) {
    console.error('💥 Failed to load operations from localStorage:', error);
    return [];
  }
}

export function saveOperationToLocal(operation: PersistentOperation): void {
  try {
    const operations = loadOperationsFromLocal();
    const existingIndex = operations.findIndex(op => op.id === operation.id);
    
    if (existingIndex >= 0) {
      operations[existingIndex] = operation;
    } else {
      operations.push(operation);
    }
    
    localStorage.setItem(OPERATIONS_KEY, JSON.stringify(operations));
    console.log(`💾 Saved operation ${operation.id} to localStorage as fallback`);
    
    const addLog = (window as any).addLog;
    if (addLog) {
      addLog(`💾 Operation saved to localStorage for ${operation.siteName}`, 'info');
    }
  } catch (error) {
    console.error('💥 Failed to save operation to localStorage:', error);
    const addLog = (window as any).addLog;
    if (addLog) {
      addLog(`💥 Failed to save operation to localStorage: ${error.message}`, 'error');
    }
  }
}

export function removeOperationFromLocal(operationId: string): void {
  try {
    const operations = loadOperationsFromLocal().filter(op => op.id !== operationId);
    localStorage.setItem(OPERATIONS_KEY, JSON.stringify(operations));
    console.log(`💾 Removed operation ${operationId} from localStorage`);
  } catch (error) {
    console.error('💥 Failed to remove operation from localStorage:', error);
    throw error;
  }
}

export function cleanupLocalOperations(): void {
  try {
    const operations = loadOperationsFromLocal();
    const now = Date.now();
    const fourHoursAgo = now - (4 * 60 * 60 * 1000); // 4 hours
    
    const activeOperations = operations.filter(op => {
      // Keep running operations that are recent (within 4 hours)
      if (op.status === 'running' && op.lastUpdateTime > fourHoursAgo) {
        return true;
      }
      // Keep paused operations that are recent (within 4 hours)
      if (op.status === 'paused' && op.lastUpdateTime > fourHoursAgo) {
        return true;
      }
      // Remove old completed/failed operations
      return false;
    });
    
    if (operations.length !== activeOperations.length) {
      console.log(`🧹 Cleaned up ${operations.length - activeOperations.length} old operations from localStorage`);
    }
    
    localStorage.setItem(OPERATIONS_KEY, JSON.stringify(activeOperations));
  } catch (error) {
    console.error('💥 Failed to cleanup operations from localStorage:', error);
  }
}