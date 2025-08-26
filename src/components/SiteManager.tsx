import React, { useState } from 'react';
import { Plus, Edit, Trash2, RefreshCw } from 'lucide-react';
import { Site } from '../types';
import SiteList from './SiteList';
import BulkOperations from './BulkOperations';
import SiteActions from './SiteActions';
import FetchStatus from './FetchStatus';
import SiteModal from './SiteModal';
import { PersistentOperation } from '../services/PersistentOperationService';

interface SiteManagerProps {
  sites: Site[];
  selectedSite: Site | null;
  onSelectSite: (site: Site) => void;
  onAddSite: (url: string) => void;
  onEditSite: (siteId: string, newUrl: string) => void;
  onRemoveSite: (siteId: string) => void;
  onUpdateSitemap: (site: Site) => void;
  onFetchEntries: (site: Site) => void;
  onDeleteAllEntries: (site: Site) => void;
  isLoading: boolean;
  maxEntries: number;
  onMaxEntriesChange: (value: number) => void;
  onExportEntries: (site: Site) => void;
  onUpdateAllSitemaps: () => void;
  onFetchAllEntries: () => void;
  onExportAllSites: () => void;
  onExportAllNewEntries: () => void;
  onDeleteAllEntriesAllSites: () => void;
  onSyncToFolder: () => void;
  onStopOperation: () => void;
  newEntriesCount?: { [siteId: string]: number };
  autoLoadStatus?: {
    isActive: boolean;
    currentSite: string;
    progress: { current: number; total: number };
    message: string;
  };
  fetchStatus?: {
    isActive: boolean;
    operation: string;
    siteName: string;
    progress: { current: number; total: number };
    message: string;
  };
  showSites: boolean;
  activeOperations: PersistentOperation[];
  onStartPersistentFetch: (site: Site) => void;
  onStopPersistentOperation: (operationId: string) => void;
  onCancelPersistentOperation: (operationId: string) => void;
}

const SiteManager: React.FC<SiteManagerProps> = ({
  sites,
  selectedSite,
  onSelectSite,
  onAddSite,
  onEditSite,
  onRemoveSite,
  onUpdateSitemap,
  onFetchEntries,
  onDeleteAllEntries,
  isLoading,
  maxEntries,
  onMaxEntriesChange,
  onExportEntries,
  onUpdateAllSitemaps,
  onFetchAllEntries,
  onExportAllSites,
  onExportAllNewEntries,
  onDeleteAllEntriesAllSites,
  onSyncToFolder,
  onStopOperation,
  newEntriesCount = {},
  autoLoadStatus,
  fetchStatus,
  showSites,
  activeOperations,
  onStartPersistentFetch,
  onStopPersistentOperation,
  onCancelPersistentOperation
}) => {
  const [showAddSite, setShowAddSite] = useState(false);
  const [showEditSite, setShowEditSite] = useState(false);
  const [newSiteUrl, setNewSiteUrl] = useState('');
  const [editUrl, setEditUrl] = useState('');

  const handleAddSite = () => {
    if (newSiteUrl.trim()) {
      onAddSite(newSiteUrl.trim());
      setNewSiteUrl('');
      setShowAddSite(false);
    }
  };

  const handleEditSite = () => {
    if (selectedSite && editUrl.trim()) {
      onEditSite(selectedSite.id, editUrl.trim());
      setEditUrl('');
      setShowEditSite(false);
    }
  };

  const showEditModal = () => {
    if (selectedSite) {
      setEditUrl(selectedSite.url);
      setShowEditSite(true);
    }
  };

  return (
    <div className="p-4 border-b border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Sites</h2>
        <button
          onClick={() => setShowAddSite(true)}
          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          title="Add Site"
        >
          <Plus size={20} />
        </button>
      </div>

      <SiteList
        sites={sites}
        selectedSite={selectedSite}
        onSelectSite={onSelectSite}
        newEntriesCount={newEntriesCount}
        autoLoadStatus={autoLoadStatus}
        showSites={showSites}
        onUpdateSitemap={onUpdateSitemap}
        onFetchEntries={onFetchEntries}
        onExportEntries={onExportEntries}
        onDeleteAllEntries={onDeleteAllEntries}
        maxEntries={maxEntries}
        isLoading={isLoading}
        activeOperations={activeOperations}
        onStartPersistentFetch={onStartPersistentFetch}
        onStopPersistentOperation={onStopPersistentOperation}
        onCancelPersistentOperation={onCancelPersistentOperation}
      />

      <BulkOperations
        sitesCount={sites.length}
        isLoading={isLoading}
        onUpdateAllSitemaps={onUpdateAllSitemaps}
        onFetchAllEntries={onFetchAllEntries}
        onExportAllSites={onExportAllSites}
        onSyncToFolder={onSyncToFolder}
        onDeleteAllEntriesAllSites={onDeleteAllEntriesAllSites}
        onStopOperation={onStopOperation}
      />

      <FetchStatus
        fetchStatus={fetchStatus}
        onStopOperation={onStopOperation}
      />

      {/* Always visible Active Operations section */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Active Operations</h3>
        {activeOperations.length === 0 ? (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-center">
            <span className="text-sm text-gray-500">No active operations</span>
          </div>
        ) : (
          activeOperations.map(operation => (
            <div key={operation.id} className="p-3 bg-green-50 border border-green-200 rounded-lg mb-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <RefreshCw size={16} className={`text-green-600 ${
                    operation.status === 'running' ? 'animate-spin' : 
                    operation.status === 'completed' ? 'text-blue-600' :
                    operation.status === 'failed' ? 'text-red-600' : ''
                  }`} />
                  <span className="text-sm font-medium text-green-900">
                    {operation.type === 'fetch_entries' ? 'Fetching Entries' : 'Updating Sitemap'}
                    {operation.status === 'paused' && ' (PAUSED)'}
                    {operation.status === 'completed' && ' (COMPLETED)'}
                    {operation.status === 'failed' && ' (FAILED)'}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => onStopPersistentOperation(operation.id)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      operation.status === 'running' 
                        ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                  >
                    {operation.status === 'running' ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Cancel operation for ${operation.siteName}? This will stop and remove the operation completely.`)) {
                        onCancelPersistentOperation(operation.id);
                      }
                    }}
                    className="text-xs px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
              
              <div className="text-sm text-green-800 mb-2">
                <strong>{operation.siteName}</strong>
              </div>
              
              <div className="text-sm text-green-700 mb-2">
                {operation.message}
              </div>
              
              {operation.progress.total > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-green-600">
                    <span>{operation.progress.current} / {operation.progress.total}</span>
                    <span>{Math.round((operation.progress.current / operation.progress.total) * 100)}%</span>
                  </div>
                  <div className="w-full bg-green-200 rounded-full h-2">
                    <div 
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${Math.min((operation.progress.current / operation.progress.total) * 100, 100)}%` 
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Site management actions - only show when a site is selected */}
      {selectedSite && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
            <label className="text-sm text-gray-600 flex-shrink-0">Max new entries:</label>
            <input
              type="number"
              value={maxEntries}
              onChange={(e) => onMaxEntriesChange(Number(e.target.value))}
              className="flex-1 p-1 text-sm border border-gray-300 rounded text-center"
              min="0"
              placeholder="0 = all new"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={showEditModal}
              className="flex-1 flex items-center justify-center gap-2 p-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <Edit size={16} />
              Edit
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Are you sure you want to delete ${selectedSite.name}?`)) {
                  onRemoveSite(selectedSite.id);
                }
              }}
              className="flex-1 flex items-center justify-center gap-2 p-2 text-sm bg-red-100 text-red-700 hover:bg-red-200 rounded-lg transition-colors"
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </div>
      )}

      <SiteModal
        show={showAddSite}
        title="Add New Site"
        value={newSiteUrl}
        onChange={setNewSiteUrl}
        onSubmit={handleAddSite}
        onCancel={() => {
          setShowAddSite(false);
          setNewSiteUrl('');
        }}
        placeholder="Enter site URL (e.g., https://example.com)"
        submitText="Add Site"
      />

      <SiteModal
        show={showEditSite}
        title="Edit Site"
        value={editUrl}
        onChange={setEditUrl}
        onSubmit={handleEditSite}
        onCancel={() => {
          setShowEditSite(false);
          setEditUrl('');
        }}
        placeholder="Enter site URL"
        submitText="Update Site"
      />
    </div>
  );
};

export default SiteManager;