import React, { useState, useEffect } from 'react';
import { X, Download, Clock, CheckCircle, AlertCircle, FileArchive, Loader2 } from 'lucide-react';
import { BackgroundExportJob, BackgroundExportService } from '../services/BackgroundExportService';

interface BackgroundExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartExport: (type: 'single_site' | 'all_sites' | 'sync', siteId?: string) => void;
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
  const [activeJobs, setActiveJobs] = useState<BackgroundExportJob[]>([]);
  const [completedJobs, setCompletedJobs] = useState<BackgroundExportJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadJobs();
      const interval = setInterval(loadJobs, 3000); // Poll every 3 seconds
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const loadJobs = async () => {
    try {
      const [active, completed] = await Promise.all([
        BackgroundExportService.getActiveJobs(),
        BackgroundExportService.getCompletedJobs()
      ]);
      setActiveJobs(active);
      setCompletedJobs(completed);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    }
  };

  const handleStartExport = async (type: 'single_site' | 'all_sites' | 'sync', siteId?: string) => {
    setIsLoading(true);
    try {
      await onStartExport(type, siteId);
      await loadJobs(); // Refresh jobs list
    } catch (error) {
      console.error('Failed to start export:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await BackgroundExportService.cancelJob(jobId);
      await loadJobs();
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatDuration = (startTime: number, endTime?: number) => {
    const duration = (endTime || Date.now()) - startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'queued':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-600" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <FileArchive className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Background Export Manager</h2>
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
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Start New Export</h3>
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
              
              <button
                onClick={() => handleStartExport('sync')}
                disabled={isLoading}
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <FileArchive className="w-8 h-8 text-indigo-600 mx-auto mb-2" />
                <div className="text-sm font-medium text-gray-900">Sync Download</div>
                <div className="text-xs text-gray-500">With GUID filenames</div>
              </button>
            </div>
          </div>

          {/* Active Jobs Section */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Active Jobs</h3>
            {activeJobs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No active export jobs</p>
              </div>
            ) : (
              <div className="space-y-4">
                {activeJobs.map(job => (
                  <div key={job.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(job.status)}
                        <div>
                          <div className="font-medium text-gray-900">
                            {job.siteName} - {job.type.replace('_', ' ')}
                          </div>
                          <div className="text-sm text-gray-500">
                            Started {formatDuration(job.createdAt)} ago
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleCancelJob(job.id)}
                        className="px-3 py-1 text-sm bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                    
                    <div className="mb-2">
                      <div className="text-sm text-gray-600 mb-1">
                        {job.progress.step} - {job.progress.currentSite}
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>{job.progress.current} / {job.progress.total}</span>
                        <span>{Math.round((job.progress.current / job.progress.total) * 100)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ 
                            width: `${Math.min((job.progress.current / job.progress.total) * 100, 100)}%` 
                          }}
                        />
                      </div>
                    </div>
                    
                    <div className="text-xs text-gray-500">
                      Estimated size: {formatFileSize(job.estimatedSize)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Completed Jobs Section */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Downloads</h3>
            {completedJobs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No completed exports in the last 7 days</p>
              </div>
            ) : (
              <div className="space-y-4">
                {completedJobs.map(job => (
                  <div key={job.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(job.status)}
                        <div>
                          <div className="font-medium text-gray-900">
                            {job.siteName} - {job.type.replace('_', ' ')}
                          </div>
                          <div className="text-sm text-gray-500">
                            Completed {formatDuration(job.createdAt, job.completedAt)} ago
                          </div>
                        </div>
                      </div>
                      {job.downloadUrl && (
                        <a
                          href={job.downloadUrl}
                          download={job.fileName}
                          className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          Download
                        </a>
                      )}
                    </div>
                    
                    {job.errorMessage && (
                      <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                        {job.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="text-xs text-gray-500 text-center">
            Files are automatically deleted after 7 days. You can close this window and exports will continue in the background.
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackgroundExportModal;