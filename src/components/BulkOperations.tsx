import React from 'react';
import { Globe, Layers, FileArchive, FolderSync, Trash2, Square } from 'lucide-react';

interface BulkOperationsProps {
  sitesCount: number;
  isLoading: boolean;
  onUpdateAllSitemaps: () => void;
  onFetchAllEntries: () => void;
  onExportAllSites: () => void;
  onSyncToFolder: () => void;
  onDeleteAllEntriesAllSites: () => void;
  onStopOperation: () => void;
}

const BulkOperations: React.FC<BulkOperationsProps> = ({
  sitesCount,
  isLoading,
  onUpdateAllSitemaps,
  onFetchAllEntries,
  onExportAllSites,
  onSyncToFolder,
  onDeleteAllEntriesAllSites,
  onStopOperation
}) => {
  if (sitesCount === 0) return null;

  return (
    <div className="mb-4 p-3 bg-gray-50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-700">Bulk Operations</h3>
        {isLoading && (
          <button
            onClick={onStopOperation}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors"
            title="Stop current operation"
          >
            <Square size={12} />
            Stop
          </button>
        )}
      </div>
      <div className="space-y-2">
        <button
          onClick={onUpdateAllSitemaps}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 p-2 text-sm bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg transition-colors disabled:opacity-50"
        >
          <Globe size={16} className={isLoading ? 'animate-spin' : ''} />
          Update All Sitemaps
        </button>
        
        <button
          onClick={onFetchAllEntries}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 p-2 text-sm bg-green-100 text-green-700 hover:bg-green-200 rounded-lg transition-colors disabled:opacity-50"
        >
          <Layers size={16} />
          Fetch All Entries
        </button>
        
        <button
          onClick={onExportAllSites}
          className="w-full flex items-center justify-center gap-2 p-2 text-sm bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-lg transition-colors"
        >
          <FileArchive size={16} />
          Export All Sites
        </button>
        
        <button
          onClick={onSyncToFolder}
          className="w-full flex items-center justify-center gap-2 p-2 text-sm bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-lg transition-colors"
          title="Download sync as ZIP file with GUID filenames"
        >
          <FolderSync size={16} />
          Download Sync ZIP
        </button>
        
        <button
          onClick={onDeleteAllEntriesAllSites}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 p-2 text-sm bg-red-100 text-red-700 hover:bg-red-200 rounded-lg transition-colors disabled:opacity-50"
        >
          <Trash2 size={16} />
          Delete All Entries (All Sites)
        </button>
      </div>
    </div>
  );
};

export default BulkOperations;