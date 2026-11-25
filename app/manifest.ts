import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BankrDex - Bankr Launch Terminal',
    short_name: 'BankrDex',
    description: 'Trade every verified Bankr launch on Base and Robinhood Chain with live charts and direct swaps.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#07080b',
    theme_color: '#07080b',
    categories: ['finance'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
