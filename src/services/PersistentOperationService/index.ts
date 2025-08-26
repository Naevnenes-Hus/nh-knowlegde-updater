import { PersistentOperation } from './types';
import { RETRY_CONFIG } from './constants';
import { 
  saveOperationToDatabase, 
  loadOperationsFromDatabase, 
  removeOperationFromDatabase, 
  cleanupOldOperationsFromDatabase,
  isDatabaseAvailable 
} from './database';
import { 
  loadOperationsFromLocal, 
  saveOperationToLocal, 
  removeOperationFromLocal, 
  cleanupLocalOperations 
} from './localStorage';
import { withRetry, withProgressRetry } from './retry';

export type { PersistentOperation } from './types';

export class PersistentOperationService {
  static async saveOperation(operation: PersistentOperation): Promise<void> {
    console.log(`💾 Saving operation ${operation.id} (${operation.status}): ${operation.message}`);
    
    const addLog = (window as any).addLog;
    
    // Try to save to database first with retry mechanism
    if (isDatabaseAvailable()) {
      try {
        await withRetry(
          () => saveOperationToDatabase(operation),
          `Database save for operation ${operation.id}`,
          RETRY_CONFIG.maxRetries,
          (attempt, maxRetries) => {
            if (addLog) {
              addLog(`⏱️ Database timeout saving operation for ${operation.siteName} (attempt ${attempt}/${maxRetries})`, 'warning');
            }
          },
          (error) => {
            if (addLog) {
              addLog(`❌ Failed to save operation for ${operation.siteName}: ${error.message}`, 'error');
            }
          }
        );
        
        console.log(`✅ Saved operation ${operation.id} to database`);
        return;
      } catch (error) {
        console.error(`💥 Failed to save operation ${operation.id} to database, falling back to localStorage:`, error);
        if (addLog) {
          addLog(`💥 Database save failed for ${operation.siteName}, using localStorage`, 'error');
        }
      }
    }

    // Fallback to localStorage
    saveOperationToLocal(operation);
  }

  static async loadOperations(): Promise<PersistentOperation[]> {
    console.log('📖 Loading operations from storage...');
    
    const addLog = (window as any).addLog;
    
    // Try to load from database first with retry mechanism
    if (isDatabaseAvailable()) {
      console.log('🔍 Database is available, loading from database...');
      
      try {
        const operations = await withRetry(
          () => loadOperationsFromDatabase(),
          'Database load operations',
          RETRY_CONFIG.maxRetries,
          (attempt, maxRetries) => {
            if (addLog) {
              addLog(`⏱️ Database timeout loading operations (attempt ${attempt}/${maxRetries})`, 'warning');
            }
          },
          (error) => {
            if (addLog) {
              addLog(`❌ Failed to load operations from database: ${error.message}`, 'error');
            }
          }
        );
        
        if (operations.length > 0) {
          console.log(`✅ Loaded ${operations.length} operations from database:`, operations.map(op => `${op.siteName} (${op.status})`));
        } else {
          console.log(`📭 No operations found in database`);
        }
        
        return operations;
      } catch (error) {
        console.warn(`💥 Failed to load operations from database, falling back to localStorage:`, error);
        if (addLog) {
          addLog(`💥 Database load failed, using localStorage`, 'error');
        }
      }
    }

    // Fallback to localStorage
    console.log('💾 Falling back to localStorage...');
    const localOps = loadOperationsFromLocal();
    if (localOps.length > 0 && addLog) {
      addLog(`💾 Loaded ${localOps.length} operations from localStorage`, 'info');
    }
    return localOps;
  }

  static async getActiveOperations(): Promise<PersistentOperation[]> {
    try {
      const operations = await this.loadOperations();
      const activeOps = operations.filter(op => op.status === 'running' || op.status === 'paused');
      
      // Only log when there are active operations or when count changes
      if (activeOps.length > 0) {
        console.log(`🔍 getActiveOperations: Found ${activeOps.length} active operations:`, activeOps.map(op => `${op.siteName} (${op.status}) ${op.progress.current}/${op.progress.total}`));
      }
      
      return activeOps;
    } catch (error) {
      console.error('💥 Failed to get active operations:', error);
      return [];
    }
  }

  static async getOperationBySiteId(siteId: string): Promise<PersistentOperation | null> {
    try {
      const operations = await this.loadOperations();
      // Return the most recent active operation for this site
      const siteOperations = operations.filter(op => 
        op.siteId === siteId && 
        (op.status === 'running' || op.status === 'paused')
      );
      
      // Sort by last update time and return the most recent
      siteOperations.sort((a, b) => b.lastUpdateTime - a.lastUpdateTime);
      return siteOperations[0] || null;
    } catch (error) {
      console.error('Failed to get operation by site ID:', error);
      return null;
    }
  }

  static async removeOperation(operationId: string): Promise<void> {
    console.log(`🗑️ Removing operation ${operationId}`);
    
    const addLog = (window as any).addLog;
    
    // Try to remove from database first with retry mechanism
    if (isDatabaseAvailable()) {
      try {
        await withRetry(
          () => removeOperationFromDatabase(operationId),
          `Database remove operation ${operationId}`,
          RETRY_CONFIG.maxRetries,
          (attempt, maxRetries) => {
            if (addLog) {
              addLog(`⏱️ Database timeout removing operation (attempt ${attempt}/${maxRetries})`, 'warning');
            }
          },
          (error) => {
            if (addLog) {
              addLog(`❌ Failed to remove operation from database: ${error.message}`, 'error');
            }
          }
        );
        
        console.log(`✅ Removed operation ${operationId} from database`);
        
        // Also remove from localStorage as a backup
        try {
          removeOperationFromLocal(operationId);
          console.log(`💾 Also removed operation ${operationId} from localStorage`);
        } catch (localError) {
          console.warn('⚠️ Failed to remove from localStorage:', localError);
        }
        
        return;
      } catch (error) {
        console.error(`💥 Failed to remove operation ${operationId} from database, falling back to localStorage:`, error);
        if (addLog) {
          addLog(`💥 Database remove failed, using localStorage`, 'error');
        }
      }
    }

    // Fallback to localStorage
    removeOperationFromLocal(operationId);
  }

  static async forceRemoveOperation(operationId: string): Promise<void> {
    console.log(`💥 Force removing operation ${operationId} from all storage locations`);
    
    // Remove from database
    try {
      if (isDatabaseAvailable()) {
        await removeOperationFromDatabase(operationId);
        console.log(`✅ Force removed operation ${operationId} from database`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to force remove from database:', error);
    }

    // Remove from localStorage
    try {
      removeOperationFromLocal(operationId);
      console.log(`💾 Force removed operation ${operationId} from localStorage`);
    } catch (error) {
      console.warn('⚠️ Failed to force remove from localStorage:', error);
    }
  }

  static async updateOperationProgress(
    operationId: string, 
    progress: { current: number; total: number; currentChunk?: number; totalChunks?: number }, 
    message: string
  ): Promise<void> {
    const addLog = (window as any).addLog;
    
    // Load operations with retry mechanism but fewer retries for progress updates
    let operations: PersistentOperation[] = [];
    
    try {
      operations = await withProgressRetry(
        () => this.loadOperations(),
        'Load operations for progress update',
        (attempt, maxRetries) => {
          // Don't spam the activity log with progress update timeouts
          if (addLog && attempt === maxRetries) {
            addLog(`⏱️ Progress update timeout after ${maxRetries} attempts`, 'warning');
          }
        }
      );
    } catch (error) {
      console.error('💥 Failed to load operations for progress update after retries:', error);
      return;
    }
    
    const operation = operations.find(op => op.id === operationId);
    if (operation) {
      operation.progress = progress;
      operation.message = message;
      operation.lastUpdateTime = Date.now();
      
      // For progress updates, try to save but don't block if it fails
      try {
        await this.saveOperation(operation);
      } catch (error) {
        console.warn('⚠️ Failed to save progress update, continuing operation:', error.message);
      }
    }
  }

  static async completeOperation(operationId: string, message: string): Promise<void> {
    console.log(`✅ Completing operation ${operationId}: ${message}`);
    
    const addLog = (window as any).addLog;
    if (addLog) {
      addLog(`✅ Operation completed: ${message}`, 'success');
    }
    
    await this.updateOperationStatus(operationId, 'completed', message);
    
    // Remove completed operations after a delay
    setTimeout(async () => {
      try {
        await this.removeOperation(operationId);
      } catch (error) {
        console.error(`💥 Failed to remove completed operation ${operationId}:`, error);
      }
    }, 8000); // Longer delay to see completion message
  }

  static async failOperation(operationId: string, message: string): Promise<void> {
    console.log(`❌ Failing operation ${operationId}: ${message}`);
    
    const addLog = (window as any).addLog;
    if (addLog) {
      addLog(`❌ Operation failed: ${message}`, 'error');
    }
    
    await this.updateOperationStatus(operationId, 'failed', message);
    
    // Remove failed operations after a delay
    setTimeout(async () => {
      try {
        await this.removeOperation(operationId);
      } catch (error) {
        console.error(`💥 Failed to remove failed operation ${operationId}:`, error);
      }
    }, 15000); // Longer delay to see failure message
  }

  static async pauseOperation(operationId: string): Promise<void> {
    console.log(`⏸️ Pausing operation ${operationId}`);
    
    const addLog = (window as any).addLog;
    
    const operation = await this.findOperationById(operationId);
    if (operation) {
      await this.updateOperationStatus(operationId, 'paused', operation.message);
      
      if (addLog) {
        addLog(`⏸️ Operation paused for ${operation.siteName}`, 'warning');
      }
    }
  }

  static async resumeOperation(operationId: string): Promise<void> {
    console.log(`▶️ Resuming operation ${operationId}`);
    
    const addLog = (window as any).addLog;
    
    const operation = await this.findOperationById(operationId);
    if (operation) {
      await this.updateOperationStatus(operationId, 'running', operation.message);
      
      if (addLog) {
        addLog(`▶️ Operation resumed for ${operation.siteName}`, 'info');
      }
    }
  }

  private static async updateOperationStatus(operationId: string, status: string, message: string): Promise<void> {
    try {
      const operations = await withRetry(
        () => this.loadOperations(),
        `Load operations for status update to ${status}`,
        RETRY_CONFIG.maxRetries
      );
      
      const operation = operations.find(op => op.id === operationId);
      if (operation) {
        operation.status = status as any;
        operation.message = message;
        operation.lastUpdateTime = Date.now();
        
        try {
          await this.saveOperation(operation);
        } catch (error) {
          console.warn(`⚠️ Failed to save ${status} status:`, error.message);
        }
      }
    } catch (error) {
      console.error(`💥 Failed to load operations for ${status} after retries:`, error);
    }
  }

  private static async findOperationById(operationId: string): Promise<PersistentOperation | null> {
    try {
      const operations = await this.loadOperations();
      return operations.find(op => op.id === operationId) || null;
    } catch (error) {
      console.error(`💥 Failed to find operation ${operationId}:`, error);
      return null;
    }
  }

  static async cleanupOldOperations(): Promise<void> {
    console.log('🧹 Cleaning up old operations...');
    
    const addLog = (window as any).addLog;
    
    // Try to cleanup from database first with retry mechanism
    if (isDatabaseAvailable()) {
      try {
        await withRetry(
          () => cleanupOldOperationsFromDatabase(),
          'Database cleanup old operations',
          RETRY_CONFIG.maxRetries,
          (attempt, maxRetries) => {
            if (addLog) {
              addLog(`⏱️ Database timeout during cleanup (attempt ${attempt}/${maxRetries})`, 'warning');
            }
          },
          (error) => {
            if (addLog) {
              addLog(`❌ Failed to cleanup old operations: ${error.message}`, 'error');
            }
          }
        );
        
        console.log(`✅ Cleaned up old operations from database`);
        return;
      } catch (error) {
        console.error(`💥 Failed to cleanup operations from database, falling back to localStorage:`, error);
        if (addLog) {
          addLog(`💥 Database cleanup failed`, 'error');
        }
      }
    }

    // Fallback to localStorage cleanup
    cleanupLocalOperations();
  }

  // Migration helper: Move localStorage operations to database
  static async migrateLocalStorageToDatabase(): Promise<void> {
    if (!isDatabaseAvailable()) {
      console.log('📭 Database not available, skipping migration');
      return;
    }

    const localOperations = loadOperationsFromLocal();
    if (localOperations.length === 0) {
      return;
    }

    console.log(`🔄 Migrating ${localOperations.length} operations from localStorage to database...`);
    
    // Migrate each operation to the database with retry mechanism
    for (const operation of localOperations) {
      try {
        await withRetry(
          () => saveOperationToDatabase(operation),
          `Migrate operation ${operation.id}`,
          RETRY_CONFIG.maxRetries
        );
        
        console.log(`✅ Migrated operation ${operation.id}`);
      } catch (error) {
        console.error(`💥 Failed to migrate operation ${operation.id}:`, error);
      }
    }
    
    // Clear localStorage after migration attempts (even if some failed)
    localStorage.removeItem('knowledge-updater-operations');
    console.log('✅ Migration completed, localStorage cleared');
  }
}