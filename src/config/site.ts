// Public origin of the site, for metadata, the sitemap and share images. Set NEXT_PUBLIC_SITE_URL
// in production; Vercel's own domain is the fallback there, localhost in development.
const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || (vercelDomain ? `https://${vercelDomain}` : 'http://localhost:3000')).replace(/\/+$/, '');
