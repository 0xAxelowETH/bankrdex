import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

// Wallet RPCs, WalletConnect relays and token logo hosts are many and change often, so
// network/image sources allow any HTTPS/WSS origin while scripts stay first-party only.
const contentSecurityPolicy = [
  "default-src 'self'",
  // Vercel Analytics serves its script same-origin in production, from va.vercel-scripts.com in dev.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // fonts.reown.com: the WalletConnect (Reown) QR modal's typeface.
  "font-src 'self' data: https://fonts.gstatic.com https://fonts.reown.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https: wss:${isDev ? ' ws:' : ''}`,
  "frame-src 'self' https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
];

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  env: {
    // VITE_ name kept as a fallback for existing .env.local files from the Vite era.
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || process.env.VITE_WALLETCONNECT_PROJECT_ID,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
