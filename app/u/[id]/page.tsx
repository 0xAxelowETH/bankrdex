import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ClientApp from '../../ClientApp';
import { getProfile, getProfileByUsername, imageUrlPath, WALLET_PATTERN } from '../../../src/server/social';

interface ProfilePageProps {
  params: Promise<{ id: string }>;
}

const ID_PATTERN = /^(0x[0-9a-f]{40}|@?[a-z0-9_]{3,20})$/;

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const id = decodeURIComponent((await params).id).toLowerCase();
  if (!ID_PATTERN.test(id)) return {};
  const profile = await (WALLET_PATTERN.test(id) ? getProfile(id) : getProfileByUsername(id)).catch(() => null);
  if (!profile) return { title: `${id.slice(0, 6)}…${id.slice(-4)} · BankrDex trader` };
  const title = `${profile.displayName ?? `@${profile.username}`} (@${profile.username}) · BankrDex`;
  const description = profile.bio ?? `Theses and trades by @${profile.username} on BankrDex.`;
  const image = imageUrlPath(profile.wallet, 'avatar', profile.avatarVersion);
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile', url: `/u/${profile.username}`, ...(image ? { images: [image] } : {}) },
    twitter: { card: 'summary', title, description, ...(image ? { images: [image] } : {}) },
  };
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const id = decodeURIComponent((await params).id).toLowerCase().replace(/^@/, '');
  if (!ID_PATTERN.test(id)) notFound();
  return <ClientApp initialView={{ profile: id }} />;
}
