import { DatabaseService } from '../DatabaseService';
import { PersistentOperation } from './types';
import { RETRY_CONFIG, getTableName } from './constants';

const db = DatabaseService.getInstance();

export async function saveOperationToDatabase(operation: PersistentOperation): Promise<void> {
  const supabase = db.getSupabaseClient();
  if (!supabase) {
    throw new Error('Database not available');
  }

  const tableName = getTableName();
  
  // Add timeout to the database operation
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Database operation timeout')), RETRY_CONFIG.operationTimeout);
  });
  
  const operationPromise = supabase
    .from(tableName)
    .upsert({
      id: operation.id,
      type: operation.type,
      site_id: operation.siteId,
      site_name: operation.siteName,
      site_url: operation.siteUrl,
      status: operation.status,
      progress: operation.progress,
      start_time: operation.startTime,
      last_update_time: operation.lastUpdateTime,
      max_entries: operation.maxEntries || 0,
      guids_to_fetch: operation.guidsToFetch || [],
      failed_guids: operation.failedGuids || [],
      message: operation.message
    });
  
  const { error } = await Promise.race([operationPromise, timeoutPromise]);

  if (error) {
    throw error;
  }
}

export async function loadOperationsFromDatabase(): Promise<PersistentOperation[]> {
  const supabase = db.getSupabaseClient();
  if (!supabase) {
    throw new Error('Database not available');
  }

  const tableName = getTableName();
  
  // Add timeout to the database query
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Database query timeout')), RETRY_CONFIG.operationTimeout);
  });
  
  const queryPromise = supabase
    .from(tableName)
    .select('*')
    .in('status', ['running', 'paused'])
    .order('last_update_time', { ascending: false });
  
  const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

  if (error) {
    throw error;
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    type: row.type,
    siteId: row.site_id,
    siteName: row.site_name,
    siteUrl: row.site_url,
    status: row.status,
    progress: row.progress || { current: 0, total: 0 },
    startTime: row.start_time,
    lastUpdateTime: row.last_update_time,
    maxEntries: row.max_entries,
    guidsToFetch: row.guids_to_fetch || [],
    failedGuids: row.failed_guids || [],
    message: row.message || ''
  }));
}

export async function removeOperationFromDatabase(operationId: string): Promise<void> {
  const supabase = db.getSupabaseClient();
  if (!supabase) {
    throw new Error('Database not available');
  }

  const tableName = getTableName();
  
  // Add timeout to the database operation
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Database delete timeout')), RETRY_CONFIG.operationTimeout);
  });
  
  const deletePromise = supabase
    .from(tableName)
    .delete()
    .eq('id', operationId);
  
  const { error } = await Promise.race([deletePromise, timeoutPromise]);

  if (error) {
    throw error;
  }
}

export async function cleanupOldOperationsFromDatabase(): Promise<void> {
  const supabase = db.getSupabaseClient();
  if (!supabase) {
    throw new Error('Database not available');
  }

  const tableName = getTableName();
  const oneHourAgo = Date.now() - (60 * 60 * 1000); // 1 hour
  
  // Remove old completed and failed operations (older than 1 hour) with timeout
  const timeoutPromise1 = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Database cleanup timeout')), RETRY_CONFIG.cleanupTimeout);
  });
  
  const deletePromise1 = supabase
    .from(tableName)
    .delete()
    .in('status', ['completed', 'failed'])
    .lt('last_update_time', oneHourAgo);
  
  const { error: deleteError } = await Promise.race([deletePromise1, timeoutPromise1]);

  if (deleteError) {
    console.error('💥 Failed to cleanup old completed/failed operations:', deleteError);
    throw deleteError;
  }

  // Remove very old running/paused operations (older than 4 hours) with timeout
  const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);
  
  const timeoutPromise2 = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Database cleanup timeout')), RETRY_CONFIG.cleanupTimeout);
  });
  
  const deletePromise2 = supabase
    .from(tableName)
    .delete()
    .in('status', ['running', 'paused'])
    .lt('last_update_time', fourHoursAgo);
  
  const { error: deleteOldError } = await Promise.race([deletePromise2, timeoutPromise2]);

  if (deleteOldError) {
    console.error('💥 Failed to cleanup old running/paused operations:', deleteOldError);
    throw deleteOldError;
  }
}

export function isDatabaseAvailable(): boolean {
  return db.isAvailable();
}