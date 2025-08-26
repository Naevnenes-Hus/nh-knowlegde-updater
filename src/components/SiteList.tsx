import React from 'react';
import { RefreshCw, Download, FileArchive, Trash2 } from 'lucide-react';
import { Site } from '../types';
import { PersistentOperation } from '../services/PersistentOperationService';

interface SiteListProps {
  sites: Site[];
  selectedSite: Site | null;
  onSelectSite: (site: Site) => void;
  newEntriesCount: { [siteId: string]: number };
  autoLoadStatus?: {
    isActive: boolean;
    currentSite: string;
    progress: { current: number; total: number };
    message: string;
  };
  showSites: boolean;
  onUpdateSitemap: (site: Site) => void;
  onFetchEntries: (site: Site) => void;
  onExportEntries: (site: Site) => void;
  onDeleteAllEntries: (site: Site) => void;
  maxEntries: number;
  isLoading: boolean;
  activeOperations: PersistentOperation[];
  onStartPersistentFetch: (site: Site) => void;
  onStopPersistentOperation: (operationId: string) => void;
  onCancelPersistentOperation: (operationId: string) => void;
}

const SiteList: React.FC<SiteListProps> = ({
  sites,
  selectedSite,
  onSelectSite,
  newEntriesCount,
  autoLoadStatus,
  showSites,
  onUpdateSitemap,
  onFetchEntries,
  onExportEntries,
  onDeleteAllEntries,
  maxEntries,
  isLoading,
  activeOperations,
  onStartPersistentFetch,
  onStopPersistentOperation,
  onCancelPersistentOperation
}) => {
  const getNewEntriesText = (site: Site) => {
    const newCount = newEntriesCount[site.id] || 0;
    if (newCount === 0) return '(No New)';
    if (maxEntries === 0) return `(All ${newCount} New)`;
    return `(Max ${Math.min(maxEntries, newCount)} of ${newCount} New)`;
  };

  const getSiteOperation = (siteId: string) => {
    return null; // Remove operation info from site cards
  };

  return (
    <div className="space-y-2 mb-4">
      {/* Auto-load status */}
      {autoLoadStatus?.isActive && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="text-blue-600 animate-spin" />
              <span className="text-sm font-medium text-blue-900">Auto-loading Entries</span>
            </div>
          </div>
          
          <div className="text-sm text-blue-800 mb-2">
            <strong>{autoLoadStatus.currentSite}</strong>
          </div>
          
          <div className="text-sm text-blue-700 mb-2">
            {autoLoadStatus.message}
          </div>
          
          {autoLoadStatus.progress.total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-blue-600">
                <span>{autoLoadStatus.progress.current} / {autoLoadStatus.progress.total}</span>
                <span>{Math.round((autoLoadStatus.progress.current / autoLoadStatus.progress.total) * 100)}%</span>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${Math.min((autoLoadStatus.progress.current / autoLoadStatus.progress.total) * 100, 100)}%` 
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
      
      {showSites && sites.map((site) => (
        <div 
          key={site.id}
          className={`group relative overflow-hidden rounded-lg border transition-all duration-300 ${
            selectedSite?.id === site.id
              ? 'border-blue-500 bg-blue-50 shadow-md'
              : 'border-gray-200 hover:bg-gray-50'
          }`}
        >
          {/* Main site info - clickable area */}
          <div 
            className={`p-3 cursor-pointer transition-all duration-300 relative ${
              selectedSite?.id === site.id ? 'pr-12' : 'pr-0'
            }`}
            onClick={() => onSelectSite(site)}
          >
            <div className="font-medium text-gray-900 flex items-center gap-2">
              {site.name}
            </div>
            <div className="text-sm text-gray-500">
              <span>{site.entryCount} entries</span>
              {newEntriesCount[site.id] > 0 && (
                <span className="inline-flex items-center ml-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  +{newEntriesCount[site.id]} new (24h)
                </span>
              )}
              <span className={site.sitemapEntryCount === 0 && site.entryCount > 0 ? 'text-red-600 font-medium' : ''}> • {site.sitemapEntryCount.toLocaleString()} in sitemap</span>
              <span> • {site.lastUpdated.toLocaleDateString('da-DK', { day: 'numeric', month: 'numeric', year: 'numeric' })}</span>
              {site.sitemapEntryCount === 0 && site.entryCount > 0 && (
                <span className="inline-flex items-center ml-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                  ⚠️ Sitemap Missing
                </span>
              )}
            </div>
          </div>

          {/* Horizontal sliding action panel from right */}
          <div className={`absolute top-0 right-0 h-full w-12 bg-white border-l border-gray-200 shadow-lg transform transition-transform duration-300 ease-in-out z-10 ${
            selectedSite?.id === site.id ? 'translate-x-0' : 'translate-x-full'
          }`}>
            <div className="flex flex-col items-center justify-center h-full space-y-1 p-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateSitemap(site);
                }}
                disabled={isLoading}
                className="w-8 h-8 flex items-center justify-center bg-blue-100 text-blue-700 hover:bg-blue-200 rounded transition-colors disabled:opacity-50"
                title="Update Sitemap"
              >
                <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              </button>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartPersistentFetch(site); 
                }}
                disabled={isLoading}
                className="w-8 h-8 flex items-center justify-center bg-green-100 text-green-700 hover:bg-green-200 rounded transition-colors disabled:opacity-50"
                title={`Start Persistent Fetch ${getNewEntriesText(site)}`}
              >
                <Download size={12} />
              </button>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExportEntries(site);
                }}
                className="w-8 h-8 flex items-center justify-center bg-purple-100 text-purple-700 hover:bg-purple-200 rounded transition-colors"
                title="Export to ZIP"
              >
                <FileArchive size={12} />
              </button>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete all entries for ${site.name}?`)) {
                    onDeleteAllEntries(site);
                  }
                }}
                className="w-8 h-8 flex items-center justify-center bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors"
                title="Delete All Entries"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>
      ))}
      
      {!showSites && sites.length > 0 && (
        <div className="text-center py-8 text-gray-500">
          <div className="animate-pulse">
            <div className="text-sm">Loading site data...</div>
            <div className="text-xs mt-1">Updating entry counts and sitemap information</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SiteList;