export interface Site {
  id: string;
  url: string;
  name: string;
  lastUpdated: Date;
  entryCount: number;
  sitemapEntryCount: number;
}

export interface Entry {
  id: string;
  title: string;
  abstract: string;
  body: string;
  publishedDate: string;
  type: string;
  seen: boolean;
  siteUrl: string;
  metadata: any;
}

export interface LogEntry {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  timestamp: Date;
}

export interface SitemapEntry {
  guid: string;
  url: string;
}