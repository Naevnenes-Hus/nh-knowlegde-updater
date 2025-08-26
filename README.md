# Knowledge Updater

A React application for managing and tracking publications from various websites.

## Environment Setup

This application supports separate databases for development and production environments:

### Development (Bolt)
- Uses tables prefixed with `dev_` (e.g., `dev_sites`, `dev_entries`, `dev_sitemaps`)
- Environment variables are set in `.env.local`
- `VITE_ENVIRONMENT=development`

### Production (Netlify)
- Uses production tables without prefix (e.g., `sites`, `entries`, `sitemaps`)
- Environment variables are set in Netlify dashboard
- `VITE_ENVIRONMENT=production`

## Database Configuration

### For Development (Bolt):
1. Environment variables are already configured in `.env.local`
2. Development tables are created automatically via migration

### For Production (Netlify):
1. Set the following environment variables in your Netlify dashboard:
   - `VITE_SUPABASE_URL`: Your production Supabase project URL
   - `VITE_SUPABASE_ANON_KEY`: Your production Supabase anon key
   - `VITE_ENVIRONMENT`: Set to `production`

2. The production tables (`sites`, `entries`, `sitemaps`) are created via the main migration

## Features

- **Site Management**: Add, edit, and remove websites to track
- **Sitemap Fetching**: Automatically fetch and parse XML sitemaps
- **Entry Management**: Fetch and store publication entries
- **Export Functionality**: Export entries to ZIP files
- **Database Storage**: Persistent storage with Supabase
- **Fallback Storage**: LocalStorage fallback when database is unavailable

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

## Environment Variables

### Development (.env.local)
```
VITE_SUPABASE_URL=your-dev-supabase-url
VITE_SUPABASE_ANON_KEY=your-dev-supabase-anon-key
VITE_ENVIRONMENT=development
```

### Production (Netlify Dashboard)
```
VITE_SUPABASE_URL=your-prod-supabase-url
VITE_SUPABASE_ANON_KEY=your-prod-supabase-anon-key
VITE_ENVIRONMENT=production
```

This setup ensures complete data isolation between your development and production environments.