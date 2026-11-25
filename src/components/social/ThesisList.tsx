import React, { useCallback, useEffect, useState } from 'react';
import { Lightbulb, Loader2, PenLine } from 'lucide-react';
import { useSocial } from '../../context/SocialContext';
import { fetchTheses, type Thesis, type ThesisQuery } from '../../services/social';
import { ThesisCard } from './ThesisCard';

const PAGE = 15;

// A paged list of theses for a token, an author or the feed. Reloads after a new post.
export const ThesisList: React.FC<{
  query: Omit<ThesisQuery, 'before' | 'offset' | 'limit'>;
  showToken?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  onCompose?: () => void;
  onLoaded?: (theses: Thesis[]) => void;
}> = ({ query, showToken = false, emptyTitle = 'No theses yet', emptyHint, onCompose, onLoaded }) => {
  const { thesesVersion } = useSocial();
  const [theses, setTheses] = useState<Thesis[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const key = JSON.stringify(query);

  useEffect(() => {
    let active = true;
    setTheses(null);
    setError(null);
    fetchTheses({ ...JSON.parse(key) as ThesisQuery, limit: PAGE })
      .then((result) => {
        if (!active) return;
        setTheses(result.theses);
        setNeedsSignIn(Boolean(result.needsSignIn));
        setHasMore(result.theses.length === PAGE);
      })
      .catch((problem: unknown) => { if (active) { setTheses([]); setError(problem instanceof Error ? problem.message : 'Could not load theses.'); } });
    return () => { active = false; };
  }, [key, thesesVersion]);

  useEffect(() => { if (theses) onLoaded?.(theses); }, [onLoaded, theses]);

  const loadMore = async () => {
    if (!theses || loadingMore) return;
    setLoadingMore(true);
    try {
      const parsed = JSON.parse(key) as ThesisQuery;
      const page = parsed.sort === 'top'
        ? await fetchTheses({ ...parsed, offset: theses.length, limit: PAGE })
        : await fetchTheses({ ...parsed, before: theses[theses.length - 1]?.createdAt, limit: PAGE });
      setTheses([...theses, ...page.theses.filter((item) => !theses.some((existing) => existing.id === item.id))]);
      setHasMore(page.theses.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  };

  const update = useCallback((next: Thesis) => setTheses((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? null), []);
  const remove = useCallback((id: string) => setTheses((current) => current?.filter((item) => item.id !== id) ?? null), []);

  if (theses === null) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1].map((index) => <div key={index} className="h-44 animate-pulse rounded-2xl border border-line bg-panel" />)}
      </div>
    );
  }
  if (theses.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-panel/50 px-6 py-10 text-center">
        <span className="rounded-2xl bg-accent/10 p-3 text-accent"><Lightbulb className="h-6 w-6" /></span>
        <h4 className="font-extrabold text-fg">{needsSignIn ? 'Sign in to see who you follow' : emptyTitle}</h4>
        {(error || emptyHint) && <p className="max-w-sm text-xs text-muted">{error ?? emptyHint}</p>}
        {onCompose && !needsSignIn && (
          <button type="button" onClick={onCompose} className="btn-gradient mt-2 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-extrabold text-white">
            <PenLine className="h-4 w-4" /> Write the first thesis
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {theses.map((thesis) => <ThesisCard key={thesis.id} thesis={thesis} showToken={showToken} onChange={update} onRemove={remove} />)}
      {hasMore && (
        <button type="button" onClick={() => void loadMore()} className="mx-auto flex items-center gap-2 rounded-full border border-line px-4 py-1.5 text-xs font-bold text-fg-soft hover:bg-raised">
          {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load more
        </button>
      )}
    </div>
  );
};
