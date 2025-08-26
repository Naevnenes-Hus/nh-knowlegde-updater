import { Site, Entry } from '../types';
import { StorageService } from '../services/StorageService';

interface UseEntryOperationsProps {
  entries: Entry[];
  setEntries: (entries: Entry[]) => void;
  selectedEntry: Entry | null;
  setSelectedEntry: (entry: Entry | null) => void;
  selectedSite: Site | null;
  sites: Site[];
  setSites: (sites: Site[]) => void;
  addLog: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
}

export const useEntryOperations = ({
  entries,
  setEntries,
  selectedEntry,
  setSelectedEntry,
  selectedSite,
  sites,
  setSites,
  addLog
}: UseEntryOperationsProps) => {
  const handleMarkAsSeen = async (entry: Entry) => {
    try {
      const updatedEntry = { ...entry, seen: true };
      await StorageService.markEntryAsSeen(updatedEntry);
      
      // Force refresh from database by updating entries array
      if (selectedSite) {
        const refreshedEntries = await StorageService.loadAllEntriesForSite(selectedSite.url);
        setEntries(refreshedEntries);
      }
      
      if (selectedEntry?.id === entry.id) {
        setSelectedEntry(updatedEntry);
      }
      
      addLog(`Marked "${entry.title}" as seen`, 'success');
    } catch (error) {
      addLog(`Failed to mark entry as seen: ${error.message}`, 'error');
    }
  };

  const handleDeleteEntry = async (entry: Entry) => {
    try {
      await StorageService.deleteEntry(entry);
      
      // Force refresh from database by updating entries array
      if (selectedSite) {
        const refreshedEntries = await StorageService.loadAllEntriesForSite(selectedSite.url);
        setEntries(refreshedEntries);
      }
      
      if (selectedEntry?.id === entry.id) {
        setSelectedEntry(null);
      }
      
      if (selectedSite) {
        const updatedSite = { 
          ...selectedSite, 
          entryCount: selectedSite.entryCount - 1, 
          lastUpdated: new Date() 
        };
        const updatedSites = sites.map(s => s.id === selectedSite.id ? updatedSite : s);
        setSites(updatedSites);
        await StorageService.saveSites(updatedSites);
      }
      
      addLog(`Deleted entry "${entry.title}"`, 'success');
    } catch (error) {
      addLog(`Failed to delete entry: ${error.message}`, 'error');
    }
  };

  return {
    handleMarkAsSeen,
    handleDeleteEntry
  };
};