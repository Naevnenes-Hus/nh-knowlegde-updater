import React from 'react';
import { RefreshCw, Square } from 'lucide-react';

interface FetchStatusProps {
  fetchStatus?: {
    isActive: boolean;
    operation: string;
    siteName: string;
    progress: { current: number; total: number };
    message: string;
  };
  onStopOperation: () => void;
}

const FetchStatus: React.FC<FetchStatusProps> = ({ fetchStatus, onStopOperation }) => {
  if (!fetchStatus?.isActive) return null;

  return (
    <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <RefreshCw size={16} className="text-blue-600 animate-spin" />
          <span className="text-sm font-medium text-blue-900">
            {fetchStatus.operation === 'sitemap' ? 'Updating Sitemap' : 'Fetching Entries'}
          </span>
        </div>
        <button
          onClick={onStopOperation}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors"
          title="Stop current operation"
        >
          <Square size={12} />
          Stop
        </button>
      </div>
      
      <div className="text-sm text-blue-800 mb-2">
        <strong>{fetchStatus.siteName}</strong>
      </div>
      
      <div className="text-sm text-blue-700 mb-2">
        {fetchStatus.message}
      </div>
      
      {fetchStatus.progress.total > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-blue-600">
            <span>{fetchStatus.progress.current} / {fetchStatus.progress.total}</span>
            <span>{Math.round((fetchStatus.progress.current / fetchStatus.progress.total) * 100)}%</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ 
                width: `${Math.min((fetchStatus.progress.current / fetchStatus.progress.total) * 100, 100)}%` 
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default FetchStatus;