export interface StorageUsage {
  used: number;
  total: number;
  percentage: number;
}

export interface StorageConfig {
  sitesKey: string;
  entriesPrefix: string;
  sitemapPrefix: string;
}