import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Database, HardDrive, Wifi, WifiOff } from 'lucide-react';
import { Site, Entry, LogEntry } from './types';
import { StorageService } from './services/StorageService';
import { ExportService } from './services/ExportService';
import { SyncService } from './services/SyncService';
import SiteManager from './components/SiteManager';
import EntryList from './components/EntryList';
import PreviewPanel from './components/PreviewPanel';
import LogPanel from './components/LogPanel';
import SyncSplashScreen from './components/SyncSplashScreen';
import ExportSplashScreen from './components/ExportSplashScreen';
import { useSiteOperations } from './hooks/useSiteOperations';
import { useEntryOperations } from './hooks/useEntryOperations';
import { useAutoLoad } from './hooks/useAutoLoad';
import { usePersistentOperations } from './hooks/usePersistentOperations';
import BackgroundExportModal from './components/BackgroundExportModal';

function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [maxEntries, setMaxEntries] = useState(0);
  const [newEntriesCount, setNewEntriesCount] = useState<{ [siteId: string]: number }>({});
  const [storageUsage, setStorageUsage] = useState(StorageService.getStorageUsage());
  const [showSites, setShowSites] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
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
  const [showBackgroundExportModal, setShowBackgroundExportModal] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const log: LogEntry = {
      id: uuidv4(),
      message,
      type,
      timestamp: new Date()
    };
    setLogs(prev => [...prev, log]);
  };

  const stopCurrentOperation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      addLog('Operation stopped by user', 'warning');
    }
  };

  const loadSites = async () => {
    try {
      const loadedSites = await StorageService.loadSites();
      setSites(loadedSites);
      addLog(`Loaded ${loadedSites.length} sites from ${StorageService.getStorageType()}`, 'success');
      return loadedSites;
    } catch (error) {
      addLog(`Failed to load sites: ${error.message}`, 'error');
      return [];
    }
  };

  const loadEntries = async (siteUrl: string) => {
    try {
      const loadedEntries = await StorageService.loadEntries(siteUrl);
      setEntries(loadedEntries);
      setSelectedEntry(null);
      addLog(`Loaded ${loadedEntries.length} entries for display`, 'info');
    } catch (error) {
      addLog(`Failed to load entries: ${error.message}`, 'error');
    }
  };

  // Initialize hooks
  const { autoLoadStatus, startAutoLoad } = useAutoLoad(addLog, setShowSites);
  
  const { activeOperations, startPersistentFetch, stopOperation, cancelOperation } = usePersistentOperations({
    sites,
    setSites,
    addLog,
    maxEntries
  });
  
  const siteOperations = useSiteOperations({
    sites,
    setSites,
    selectedSite,
    setSelectedSite,
    addLog,
    isLoading,
    setIsLoading,
    abortControllerRef,
    newEntriesCount,
    setNewEntriesCount,
    loadEntries,
    maxEntries
  });

  const entryOperations = useEntryOperations({
    entries,
    setEntries,
    selectedEntry,
    setSelectedEntry,
    selectedSite,
    sites,
    setSites,
    addLog
  });

  useEffect(() => {
    const initializeApp = async () => {
      setIsInitializing(true);
      
      // Make addLog available globally for services
      (window as any).addLog = addLog;
      
      // Load sites first
      const loadedSites = await loadSites();
      
      // Show sites immediately
      setShowSites(true);
      
      // End initialization phase quickly
      setIsInitializing(false);
      
      // Start background auto-load to update site counts
      startAutoLoad(loadedSites, setSelectedSite, setEntries, setSites);
    };
    
    initializeApp();
    
    const interval = setInterval(() => {
      setStorageUsage(StorageService.getStorageUsage());
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Cleanup global addLog on unmount
  useEffect(() => {
    return () => {
      delete (window as any).addLog;
    };
  }, []);

  useEffect(() => {
    if (selectedSite) {
      // Don't auto-load entries - let EntryList handle loading based on active tab
    }
  }, [selectedSite]);

  // Filter new entries to only include those from the last 24 hours
  const getRecentNewEntries = (entries: Entry[]) => {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    return entries.filter(entry => {
      if (entry.seen) return false;
      
      // Check when entry was stored in database (created_at), fall back to published_date only if no created_at
      const entryDate = entry.metadata?.created_at ? 
        new Date(entry.metadata.created_at) : 
        (entry.publishedDate ? new Date(entry.publishedDate) : new Date(0));
      
      return entryDate >= oneDayAgo;
    });
  };

  const recentNewEntries = getRecentNewEntries(entries);
  const handleExportEntries = async (site: Site) => {
    setShowBackgroundExportModal(true);
  };

  const handleExportAllSites = async () => {
    setShowBackgroundExportModal(true);
  };

  const handleSyncToFolder = async () => {
    setShowBackgroundExportModal(true);
  };

  const handleStartBackgroundExport = async (type: 'single_site' | 'all_sites', siteId?: string) => {
    // Export is handled directly in the modal component
  };

  const storageType = StorageService.getStorageType();

  // Show loading screen during initialization
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading Knowledge Updater</h2>
          <p className="text-gray-600">Loading sites and checking for active operations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Knowledge Updater</h1>
                <p className="text-sm text-gray-600">Publication tracking and management system</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                {storageType === 'database' ? (
                  <>
                    <Wifi className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-medium text-green-700">Database</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4 text-orange-600" />
                    <span className="text-sm font-medium text-orange-700">Local Storage</span>
                  </>
                )}
              </div>

              {storageType === 'local' && (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                  <HardDrive className="w-4 h-4 text-gray-600" />
                  <span className="text-sm text-gray-600">
                    {storageUsage.percentage.toFixed(1)}% used
                  </span>
                </div>
              )}

              <div className="text-right">
                <div className="text-sm font-medium text-gray-900">{sites.length} Sites</div>
                <div className="text-xs text-gray-500">{recentNewEntries.length} New Entries (24h)</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
          <SiteManager
            sites={sites}
            selectedSite={selectedSite}
            onSelectSite={setSelectedSite}
            onAddSite={siteOperations.handleAddSite}
            onEditSite={siteOperations.handleEditSite}
            onRemoveSite={siteOperations.handleRemoveSite}
            onUpdateSitemap={siteOperations.handleUpdateSitemap}
            onFetchEntries={siteOperations.handleFetchEntries}
            onDeleteAllEntries={siteOperations.handleDeleteAllEntries}
            isLoading={isLoading}
            maxEntries={maxEntries}
            onMaxEntriesChange={setMaxEntries}
            onExportEntries={handleExportEntries}
            onUpdateAllSitemaps={siteOperations.handleUpdateAllSitemaps}
            onFetchAllEntries={siteOperations.handleFetchAllEntries}
            onExportAllSites={handleExportAllSites}
            onDeleteAllEntriesAllSites={siteOperations.handleDeleteAllEntriesAllSites}
            onSyncToFolder={handleSyncToFolder}
            onStopOperation={stopCurrentOperation}
            newEntriesCount={newEntriesCount}
            autoLoadStatus={autoLoadStatus}
            fetchStatus={siteOperations.fetchStatus}
            showSites={showSites}
            activeOperations={activeOperations}
            onStartPersistentFetch={startPersistentFetch}
            onStopPersistentOperation={stopOperation}
            onCancelPersistentOperation={cancelOperation}
          />
          
          <EntryList
            entries={entries}
            newEntries={recentNewEntries}
            selectedEntry={selectedEntry}
            selectedSite={selectedSite}
            onSelectEntry={setSelectedEntry}
            onMarkAsSeen={entryOperations.handleMarkAsSeen}
            onDeleteEntry={entryOperations.handleDeleteEntry}
          />
        </div>

        <div className="flex-1 flex flex-col">
          <PreviewPanel
            entry={selectedEntry}
            onMarkAsSeen={entryOperations.handleMarkAsSeen}
            onDeleteEntry={entryOperations.handleDeleteEntry}
          />
          
          <LogPanel logs={logs} />
        </div>
      </div>
      
      {/* Sync Splash Screen */}
      <SyncSplashScreen
        isVisible={syncProgress.isVisible}
        progress={syncProgress}
      />
      
      {/* Export Splash Screen */}
      <ExportSplashScreen
        isVisible={exportProgress.isVisible}
        progress={exportProgress}
      />
      
      {/* Background Export Modal */}
      <BackgroundExportModal
        isOpen={showBackgroundExportModal}
        onClose={() => setShowBackgroundExportModal(false)}
        onStartExport={handleStartBackgroundExport}
        sites={sites}
        selectedSite={selectedSite}
      />
    </div>
  );
}

export default App;