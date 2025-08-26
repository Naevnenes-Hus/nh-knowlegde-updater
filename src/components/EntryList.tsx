import React, { useState, useEffect } from 'react';
import { FileText, Eye, Trash2, Copy, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Entry, Site } from '../types';
import { StorageService } from '../services/StorageService';

interface EntryListProps {
  entries: Entry[];
  newEntries: Entry[];
  selectedEntry: Entry | null;
  selectedSite: Site | null;
  onSelectEntry: (entry: Entry) => void;
  onMarkAsSeen: (entry: Entry) => void;
  onDeleteEntry: (entry: Entry) => void;
}

const GuidEntry: React.FC<{
  entry: Entry;
  isSelected: boolean;
  onSelect: () => void;
  onMarkAsSeen: () => void;
  onDelete: () => void;
}> = ({ entry, isSelected, onSelect, onMarkAsSeen, onDelete }) => {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Check if entry is truly "new" (unseen AND within last 24 hours)
  const isRecentlyNew = () => {
    if (entry.seen) return false;
    
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    // Check when entry was stored in database (created_at), fall back to published_date only if no created_at
    const entryDate = entry.metadata?.created_at ? 
      new Date(entry.metadata.created_at) : 
      (entry.publishedDate ? new Date(entry.publishedDate) : new Date(0));
    
    return entryDate >= oneDayAgo;
  };
  return (
    <div
      className={`p-2 rounded border cursor-pointer transition-colors group flex items-center justify-between ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 hover:bg-gray-50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="font-mono text-sm text-gray-700 truncate">
          {entry.id}
        </span>
        {isRecentlyNew() && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 flex-shrink-0">
            New
          </span>
        )}
      </div>
      
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(entry.id);
          }}
          className="p-1 text-gray-600 hover:bg-gray-100 rounded transition-all"
          title="Copy GUID"
        >
          <Copy size={14} />
        </button>
        
        {isRecentlyNew() && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkAsSeen();
            }}
            className="p-1 text-green-600 hover:bg-green-50 rounded transition-all"
            title="Mark as seen"
          >
            <Eye size={14} />
          </button>
        )}
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete entry ${entry.id}?`)) {
              onDelete();
            }
          }}
          className="p-1 text-red-600 hover:bg-red-50 rounded transition-all"
          title="Delete entry"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

const Pagination: React.FC<{
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}> = ({ currentPage, totalPages, onPageChange }) => {
  if (totalPages <= 1) return null;

  const getVisiblePages = () => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];

    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
      range.push(i);
    }

    if (currentPage - delta > 2) {
      rangeWithDots.push(1, '...');
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (currentPage + delta < totalPages - 1) {
      rangeWithDots.push('...', totalPages);
    } else {
      rangeWithDots.push(totalPages);
    }

    return rangeWithDots;
  };

  const visiblePages = getVisiblePages();

  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Previous page"
      >
        <ChevronLeft size={16} />
      </button>

      {visiblePages.map((page, index) => (
        <React.Fragment key={index}>
          {page === '...' ? (
            <span className="px-3 py-2 text-gray-500">...</span>
          ) : (
            <button
              onClick={() => onPageChange(page as number)}
              className={`px-3 py-2 rounded-lg border transition-colors ${
                currentPage === page
                  ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                  : 'border-gray-300 hover:bg-gray-50 text-gray-700'
              }`}
            >
              {page}
            </button>
          )}
        </React.Fragment>
      ))}

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Next page"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
};

const EntryList: React.FC<EntryListProps> = ({
  entries,
  newEntries,
  selectedEntry,
  selectedSite,
  onSelectEntry,
  onMarkAsSeen,
  onDeleteEntry
}) => {
  const [activeTab, setActiveTab] = useState<'new' | 'all'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [displayEntries, setDisplayEntries] = useState<Entry[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [allCount, setAllCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  
  const ENTRIES_PER_PAGE = 10;
  const MAX_SAFE_ENTRIES_PER_PAGE = 25; // Maximum entries per page to avoid timeouts

  // Get counts from database without loading entries
  const loadCounts = async () => {
    if (!selectedSite) {
      setNewCount(0);
      setAllCount(0);
      return;
    }

    try {
      // Get counts efficiently from database
      const totalCount = await StorageService.getActualEntryCount(selectedSite.url);
      const unseenCount = await StorageService.getUnseenEntryCount(selectedSite.url);
      
      setAllCount(totalCount);
      setNewCount(unseenCount);
    } catch (error) {
      console.error('Failed to load entry counts:', error);
      setAllCount(0);
      setNewCount(0);
    }
  };

  // Load entries for current page and tab
  const loadEntriesForPage = async (page: number, tab: 'new' | 'all') => {
    if (!selectedSite) {
      setDisplayEntries([]);
      return;
    }

    setIsLoading(true);
    try {
      console.log(`Loading page ${page} of ${tab} entries for ${selectedSite.name}...`);
      
      const safeLimit = Math.min(ENTRIES_PER_PAGE, MAX_SAFE_ENTRIES_PER_PAGE);
      const offset = (page - 1) * safeLimit;
      
      // Load entries based on tab selection
      let entries: Entry[];
      if (tab === 'new') {
        console.log(`Loading ${safeLimit} unseen entries starting from offset ${offset}`);
        // For new entries, use proper database pagination for unseen entries
        entries = await StorageService.loadUnseenEntriesWithLimit(selectedSite.url, safeLimit, offset);
      } else {
        // For all entries, we can use database pagination
        entries = await StorageService.loadEntriesWithLimit(selectedSite.url, safeLimit, offset);
      }
      
      setDisplayEntries(entries);
      console.log(`Loaded ${entries.length} entries for ${tab} tab, page ${page}`);
      console.log(`Loaded ${entries.length} entries for page ${page}`);
    } catch (error) {
      console.error('Failed to load entries from database:', error);
      setDisplayEntries([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    loadEntriesForPage(page, activeTab);
  };

  // Load counts when site changes (but not entries)
  useEffect(() => {
    setDisplayEntries([]);
    setCurrentPage(1);
    loadCounts();
  }, [selectedSite]);

  // Listen for external changes (after fetch, mark as seen, delete)
  useEffect(() => {
    // If entries prop changes (from external operations), refresh counts and current page
    if (selectedSite) {
      console.log('External entries change detected, refreshing counts and current page...');
      loadCounts();
      // Reload current page to reflect changes
      loadEntriesForPage(currentPage, activeTab);
    }
  }, [entries, selectedSite]);

  const handleTabChange = (tab: 'new' | 'all') => {
    setActiveTab(tab);
    setCurrentPage(1); // Reset to first page when changing tabs
    
    // Load first page of the selected tab
    loadEntriesForPage(1, tab);
  };

  const handleRefresh = () => {
    console.log('Manual refresh requested');
    loadCounts();
    // Reload current page
    loadEntriesForPage(currentPage, activeTab);
  };

  // Calculate total pages based on counts
  const totalEntries = activeTab === 'new' ? newCount : allCount;
  const safeLimit = Math.min(ENTRIES_PER_PAGE, MAX_SAFE_ENTRIES_PER_PAGE);
  const totalPages = Math.ceil(totalEntries / safeLimit);

  // Debug logging
  useEffect(() => {
    console.log(`EntryList state: activeTab=${activeTab}, newCount=${newCount}, allCount=${allCount}, displayEntries=${displayEntries.length}, totalPages=${totalPages}`);
  }, [activeTab, newCount, allCount, displayEntries.length, totalPages]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Entries</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="p-1 text-gray-600 hover:bg-gray-100 rounded transition-all"
            title="Refresh from database"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => handleTabChange('all')}
              disabled={isLoading}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeTab === 'all'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              All ({allCount})
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-1 max-h-96 overflow-y-auto">
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
            <p>Loading from database...</p>
          </div>
        ) : !selectedSite ? (
          <div className="text-center py-8 text-gray-500">
            <FileText size={48} className="mx-auto mb-2 opacity-50" />
            <p>Select a site to view entries</p>
          </div>
        ) : displayEntries.length === 0 && !isLoading ? (
          <div className="text-center py-8 text-gray-500">
            <FileText size={48} className="mx-auto mb-2 opacity-50" />
            <p>No {activeTab === 'new' ? 'new' : ''} entries found for {selectedSite.name}</p>
            {activeTab === 'new' && allCount > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                All entries have been seen
              </p>
            )}
          </div>
        ) : (
          <>
            {displayEntries.map((entry) => (
              <GuidEntry
                key={entry.id}
                entry={entry}
                isSelected={selectedEntry?.id === entry.id}
                onSelect={() => onSelectEntry(entry)}
                onMarkAsSeen={() => onMarkAsSeen(entry)}
                onDelete={() => onDeleteEntry(entry)}
              />
            ))}
          </>
        )}
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      )}
      
      {/* Status info */}
      {selectedSite && (
        <div className="mt-2 text-xs text-gray-500 text-center">
          {totalEntries > 0 ? (
            <>
              Showing {((currentPage - 1) * ENTRIES_PER_PAGE) + 1}-{Math.min(currentPage * ENTRIES_PER_PAGE, totalEntries)} of {totalEntries} {activeTab === 'new' ? 'new' : ''} entries
              {totalPages > 1 && ` (Page ${currentPage} of ${totalPages})`}
            </>
          ) : (
            `No ${activeTab === 'new' ? 'new' : ''} entries found`
          )}
        </div>
      )}
    </div>
  );
};

export default EntryList;