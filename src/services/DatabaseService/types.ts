export interface DatabaseConfig {
  supabaseUrl: string;
  supabaseKey: string;
  environment: string;
}

export interface QueryOptions {
  timeout?: number;
  retries?: number;
}

export interface BatchConfig {
  chunkSize: number;
  delayBetweenChunks: number;
  timeout: number;
}