import React, { useEffect, useRef, useState } from 'react';
import { AtSign, Camera, Check, Globe, ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { useSocial } from '../../context/SocialContext';
import { checkUsername, imageUrl, removeImage, saveProfile, uploadImage, type Profile } from '../../services/social';
import { ACCENTS, ProfileAvatar, walletGradient } from './SocialBits';

const IMAGE_SIZES = { avatar: { width: 256, height: 256, limit: 200 * 1024 }, banner: { width: 1200, height: 400, limit: 500 * 1024 } } as const;

// Center-crops and resizes in the browser, so uploads are small WebP (or JPEG) files.
async function prepareImage(file: File, kind: 'avatar' | 'banner'): Promise<Blob> {
  if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is too large (15 MB max).');
  const bitmap = await createImageBitmap(file);
  const { width, height, limit } = IMAGE_SIZES[kind];
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image editing is not available in this browser.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height);
  bitmap.close();
  const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  for (const [type, quality] of [['image/webp', 0.86], ['image/webp', 0.7], ['image/jpeg', 0.82], ['image/jpeg', 0.65]] as const) {
    const blob = await encode(type, quality);
    if (blob && blob.type === type && blob.size <= limit) return blob;
  }
  throw new Error('Could not compress that image enough. Try another one.');
}

type Field = 'username' | 'displayName' | 'bio' | 'x' | 'farcaster' | 'website';

export const ProfileEditorModal: React.FC = () => {
  const { wallet, profile, setProfile, setIsProfileEditorOpen, signOut } = useSocial();
  const isNew = !profile;
  const [form, setForm] = useState<Record<Field, string>>({
    username: profile?.username ?? '',
    displayName: profile?.displayName ?? '',
    bio: profile?.bio ?? '',
    x: profile?.x ?? '',
    farcaster: profile?.farcaster ?? '',
    website: profile?.website ?? '',
  });
  const [accent, setAccent] = useState<string>(profile?.accent ?? ACCENTS[0]);
  const [usernameState, setUsernameState] = useState<{ checking: boolean; available?: boolean; reason?: string }>({ checking: false });
  const [images, setImages] = useState({ avatar: profile?.avatarVersion ?? 0, banner: profile?.bannerVersion ?? 0 });
  const [pending, setPending] = useState<{ avatar?: Blob; banner?: Blob }>({});
  const [previews, setPreviews] = useState<{ avatar?: string; banner?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const close = () => setIsProfileEditorOpen(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  useEffect(() => () => { Object.values(previews).forEach((url) => url && URL.revokeObjectURL(url)); }, [previews]);

  // Live availability check while typing the username.
  useEffect(() => {
    const username = form.username.trim().replace(/^@/, '').toLowerCase();
    if (!username || username === profile?.username) { setUsernameState({ checking: false, available: username ? true : undefined }); return; }
    setUsernameState({ checking: true });
    const timer = window.setTimeout(() => {
      checkUsername(username)
        .then((result) => setUsernameState({ checking: false, ...result }))
        .catch(() => setUsernameState({ checking: false }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form.username, profile?.username]);

  if (!wallet) return null;
  const set = (field: Field) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [field]: field === 'username' ? event.target.value.toLowerCase().replace(/[^a-z0-9_@]/g, '') : event.target.value }));

  const pick = async (kind: 'avatar' | 'banner', file?: File) => {
    if (!file) return;
    setError(null);
    try {
      const blob = await prepareImage(file, kind);
      setPending((current) => ({ ...current, [kind]: blob }));
      setPreviews((current) => ({ ...current, [kind]: URL.createObjectURL(blob) }));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not read that image.');
    }
  };

  const clearImage = async (kind: 'avatar' | 'banner') => {
    setPending((current) => ({ ...current, [kind]: undefined }));
    setPreviews((current) => ({ ...current, [kind]: undefined }));
    if (images[kind] > 0 && profile) {
      try {
        await removeImage(kind);
        setImages((current) => ({ ...current, [kind]: 0 }));
        setProfile({ ...profile, [`${kind}Version`]: 0 } as Profile);
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : 'Could not remove the image.');
      }
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let { profile: saved } = await saveProfile({
        username: form.username,
        displayName: form.displayName,
        bio: form.bio,
        accent,
        x: form.x,
        farcaster: form.farcaster,
        website: form.website,
      });
      for (const kind of ['avatar', 'banner'] as const) {
        const blob = pending[kind];
        if (!blob) continue;
        const { version } = await uploadImage(kind, blob);
        saved = { ...saved, [`${kind}Version`]: version };
      }
      setProfile(saved);
      close();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  const avatarSrc = previews.avatar ?? imageUrl(wallet, 'avatar', images.avatar);
  const bannerSrc = previews.banner ?? imageUrl(wallet, 'banner', images.banner);
  const cleanUsername = form.username.replace(/^@/, '');
  const inputClass = 'w-full rounded-xl border border-line bg-sunken/60 px-3 py-2.5 text-sm text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={isNew ? 'Create your profile' : 'Edit profile'}>
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={close} />
      <form onSubmit={submit} className="relative flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-line bg-panel shadow-2xl shadow-black/60 sm:rounded-3xl">
        {/* Banner + avatar */}
        <div className="relative h-36 shrink-0 sm:h-40" style={{ background: bannerSrc ? undefined : walletGradient(wallet, accent) }}>
          {bannerSrc && <img src={bannerSrc} alt="" className="h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-panel via-transparent to-black/20" />
          <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-3 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"><X className="h-4 w-4" /></button>
          <div className="absolute left-3 top-3 flex gap-1.5">
            <button type="button" onClick={() => bannerInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-bold text-white backdrop-blur hover:bg-black/75">
              <ImagePlus className="h-3.5 w-3.5" /> Banner
            </button>
            {bannerSrc && <button type="button" onClick={() => void clearImage('banner')} aria-label="Remove banner" className="rounded-full bg-black/55 p-1.5 text-white hover:bg-black/75"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
          <input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => void pick('banner', event.target.files?.[0])} />
          <div className="absolute -bottom-10 left-5">
            <button type="button" onClick={() => avatarInput.current?.click()} className="group relative block rounded-full ring-4 ring-panel" aria-label="Upload avatar">
              {avatarSrc
                ? <img src={avatarSrc} alt="" className="h-20 w-20 rounded-full object-cover" />
                : <ProfileAvatar wallet={wallet} card={{ username: cleanUsername || 'bx', displayName: form.displayName || null, avatarVersion: 0, accent }} size={80} />}
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition group-hover:opacity-100"><Camera className="h-5 w-5 text-white" /></span>
            </button>
            {avatarSrc && <button type="button" onClick={() => void clearImage('avatar')} aria-label="Remove avatar" className="absolute -right-1 bottom-0 rounded-full border border-line bg-panel p-1 text-muted hover:text-down"><Trash2 className="h-3 w-3" /></button>}
            <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => void pick('avatar', event.target.files?.[0])} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-12">
          <h2 className="text-lg font-extrabold text-fg">{isNew ? 'Create your trader profile' : 'Edit profile'}</h2>
          <p className="mb-4 text-xs text-muted">Your username and avatar appear on your trades, theses and the leaderboard. Linked to {wallet.slice(0, 6)}…{wallet.slice(-4)}.</p>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-xs font-semibold text-fg-soft">
                Username
                <span className="font-normal">
                  {usernameState.checking && <Loader2 className="inline h-3 w-3 animate-spin text-muted" />}
                  {!usernameState.checking && usernameState.available === true && cleanUsername && <span className="text-up"><Check className="inline h-3 w-3" /> available</span>}
                  {!usernameState.checking && usernameState.available === false && <span className="text-down">{usernameState.reason}</span>}
                </span>
              </span>
              <span className="relative block">
                <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                <input value={form.username} onChange={set('username')} required minLength={3} maxLength={21} placeholder="satoshi_trades" autoComplete="off" className={`${inputClass} pl-9 font-mono`} />
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-fg-soft">Display name</span>
                <input value={form.displayName} onChange={set('displayName')} maxLength={32} placeholder="Satoshi" className={inputClass} />
              </label>
              <div>
                <span className="mb-1 block text-xs font-semibold text-fg-soft">Profile color</span>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {ACCENTS.map((color) => (
                    <button key={color} type="button" onClick={() => setAccent(color)} aria-label={`Color ${color}`} aria-pressed={accent === color}
                      className={`h-6 w-6 rounded-full transition ${accent === color ? 'scale-110 ring-2 ring-fg ring-offset-2 ring-offset-panel' : 'hover:scale-110'}`} style={{ background: color }} />
                  ))}
                </div>
              </div>
            </div>
            <label className="block">
              <span className="mb-1 flex justify-between text-xs font-semibold text-fg-soft">Bio <span className="font-normal text-subtle">{form.bio.length}/160</span></span>
              <textarea value={form.bio} onChange={set('bio')} maxLength={160} rows={2} placeholder="Degen since block 1. Bankr launches only." className={`${inputClass} resize-none`} />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-fg-soft">X</span>
                <input value={form.x} onChange={set('x')} maxLength={60} placeholder="@handle" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-fg-soft">Farcaster</span>
                <input value={form.farcaster} onChange={set('farcaster')} maxLength={60} placeholder="@name" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-fg-soft"><Globe className="h-3 w-3" /> Website</span>
                <input value={form.website} onChange={set('website')} maxLength={200} placeholder="https://…" className={inputClass} />
              </label>
            </div>
          </div>

          {error && <p role="alert" className="mt-3 rounded-xl border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-panel px-5 py-3">
          <button type="button" onClick={() => { void signOut(); close(); }} className="text-xs font-semibold text-subtle hover:text-down">Sign out</button>
          <div className="flex gap-2">
            <button type="button" onClick={close} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-fg-soft hover:bg-raised">Cancel</button>
            <button type="submit" disabled={busy || usernameState.available === false || cleanUsername.length < 3} className="btn-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-extrabold text-white disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isNew ? 'Create profile' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
