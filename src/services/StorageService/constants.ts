import { StorageConfig } from './types';

export const STORAGE_CONFIG: StorageConfig = {
  sitesKey: 'knowledge-updater-sites',
  entriesPrefix: 'knowledge-updater-entries-',
  sitemapPrefix: 'knowledge-updater-sitemap-',
};

export function sanitizeUrl(url: string): string {
  return url.replace(/[^a-zA-Z0-9]/g, '_');
}