import React, { useState, useEffect } from 'react';
import { X, Download, Clock, CheckCircle, AlertCircle, FileArchive, Loader2, Trash2 } from 'lucide-react';
import { ExportService } from '../services/ExportService';

interface BackgroundExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartExport: (type: 'single_site' | 'all_sites', siteId?: string) => Promise<void>;
  sites: any[];
  selectedSite?: any;
}

const BackgroundExportModal: React.FC<BackgroundExportModalProps> = ({
  isOpen,
  onClose,
  onStartExport,
  sites,
  selectedSite
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    isVisible: boolean;
    step: string;
    currentSite: string;
    sitesProcessed: number;
    totalSites: number;
    entriesProcessed: number;
    totalEntries: number;
    isComplete: boolean;
  }>({
    isVisible: false,
    step: '',
    currentSite: '',
    sitesProcessed: 0,
    totalSites: 0,
    entriesProcessed: 0,
    totalEntries: 0,
    isComplete: false
  });

  const handleStartExport = async (type: 'single_site' | 'all_sites', siteId?: string) => {
    setIsLoading(true);
    setExportProgress({
      isVisible: true,
      step: 'starting',
      currentSite: '',
      sitesProcessed: 0,
      totalSites: type === 'single_site' ? 1 : sites.length,
      entriesProcessed: 0,
      totalEntries: 0,
      isComplete: false
    });
    
    try {
      if (type === 'single_site' && selectedSite) {
        await ExportService.exportSiteEntriesToZip(selectedSite, (progress) => {
          setExportProgress(prev => ({
            ...prev,
            ...progress
          }));
        });
      } else if (type === 'all_sites') {
        await ExportService.exportAllSitesToZip(sites, (progress) => {
          setExportProgress(prev => ({
            ...prev,
            ...progress
          }));
        });
      }
      
      setExportProgress(prev => ({
        ...prev,
        isComplete: true,
        step: 'complete'
      }));
      
      setTimeout(() => {
        setExportProgress(prev => ({ ...prev, isVisible: false }));
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Failed to start export:', error);
      setExportProgress(prev => ({
        ...prev,
        isVisible: false
      }));
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <FileArchive className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Export Manager</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {/* Start New Export Section */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Start Export</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {selectedSite && (
                <button
                  onClick={() => handleStartExport('single_site', selectedSite.id)}
                  disabled={isLoading}
                  className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <FileArchive className="w-8 h-8 text-purple-600 mx-auto mb-2" />
                  <div className="text-sm font-medium text-gray-900">Export Site</div>
                  <div className="text-xs text-gray-500">{selectedSite.name}</div>
                </button>
              )}
              
              <button
                onClick={() => handleStartExport('all_sites')}
                disabled={isLoading}
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <FileArchive className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                <div className="text-sm font-medium text-gray-900">Export All Sites</div>
                <div className="text-xs text-gray-500">{sites.length} sites</div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="text-xs text-gray-500 text-center">
            Export will start immediately and download when complete. Keep this window open during export.
          </div>
        </div>
      </div>
      </div>
      
      {/* Export Progress Overlay */}
      {exportProgress.isVisible && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-60">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 p-6">
            <div className="text-center mb-4">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileArchive className="w-8 h-8 text-purple-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                {exportProgress.isComplete ? 'Export Complete!' : 'Preparing Export'}
              </h2>
              <p className="text-gray-600 text-sm">
                {exportProgress.isComplete ? 'Your download should start automatically' : 'Please wait while we prepare your export'}
              </p>
            </div>
            
            {!exportProgress.isComplete && (
              <>
                <div className="mb-4">
                  <div className="text-sm text-gray-700 mb-2">
                    {exportProgress.step}: {exportProgress.currentSite}
                  </div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Sites: {exportProgress.sitesProcessed} / {exportProgress.totalSites}</span>
                    <span>Entries: {exportProgress.entriesProcessed.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${Math.min((exportProgress.sitesProcessed / exportProgress.totalSites) * 100, 100)}%` 
                      }}
                    />
                  </div>
                </div>
                
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs text-yellow-800">
                    <strong>Please wait:</strong> Do not close this window while the export is being prepared.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default BackgroundExportModal;