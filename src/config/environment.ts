// Environment configuration
export const config = {
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  },
  environment: import.meta.env.VITE_ENVIRONMENT || 'development',
  isDevelopment: import.meta.env.VITE_ENVIRONMENT === 'development',
  isProduction: import.meta.env.VITE_ENVIRONMENT === 'production',
};

// Database table prefixes based on environment
export const getTablePrefix = () => {
  return config.isDevelopment ? 'dev_' : '';
};

// Get environment-specific table names
export const getTableName = (baseName: string) => {
  return `${getTablePrefix()}${baseName}`;
};