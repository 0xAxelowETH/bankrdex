import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

import { SITE_URL as siteUrl } from '../src/config/site';

const siteTitle = 'BankrDex - Trade every Bankr launch on Base and Robinhood Chain';
const siteDescription =
  'The trading terminal for verified Bankr launches: live charts, direct Uniswap V4 swaps, safety checks, trader theses and portfolio tracking.';
// X / Twitter large cards are 2:1; the 1.91:1 image is for Open Graph (Telegram, Discord, …).
const twitterBanner = {
  url: '/BankrDex%20Banner%202x1.jpg',
  width: 2400,
  height: 1200,
  alt: 'BankrDex: trade every Bankr launch on Base and Robinhood Chain',
};
const socialBanner = {
  url: '/BankrDex%20OG.jpg',
  width: 1200,
  height: 630,
  alt: 'BankrDex: trade every Bankr launch on Base and Robinhood Chain',
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: siteDescription,
  icons: {
    icon: [
      { url: '/sources/bankrdex-mark.svg', type: 'image/svg+xml' },
      { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'BankrDex', statusBarStyle: 'black-translucent' },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    type: 'website',
    url: '/',
    images: [socialBanner],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
    images: [twitterBanner],
  },
};

export const viewport: Viewport = {
  themeColor: "#07080b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
        {/* The script only exists on Vercel after Web Analytics is enabled in the dashboard;
            elsewhere it 404s for every visitor, so it is opt-in. */}
        {process.env.NEXT_PUBLIC_VERCEL_ANALYTICS === '1' && <Analytics />}
      </body>
    </html>
  );
}
