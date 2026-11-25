import React, { useCallback, useState } from 'react';
import { CandlestickChart, Check, Flag, Heart, Link2, Loader2, MessageCircle, Send, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useSocial } from '../../context/SocialContext';
import {
  deleteComment,
  deleteThesis,
  fetchComments,
  likeThesis,
  postComment,
  thesisPerformance,
  thesisStatus,
  timeAgo,
  TIMEFRAME_LABEL,
  type Thesis,
  type ThesisComment,
} from '../../services/social';
import { OkxTokenLogo } from '../OkxTokenLogo';
import { formatPrice, TraderLabel } from './SocialBits';

// Opens a token's terminal: in place when the token is loaded, otherwise via its URL.
export function useOpenToken() {
  const { tokens, setActiveToken } = useApp();
  const { navigate } = useSocial();
  return useCallback((address: string, chain = 'base') => {
    const key = address.toLowerCase();
    const token = tokens.find((candidate) => candidate.address.toLowerCase() === key && (candidate.chain ?? 'base') === chain);
    if (token) {
      setActiveToken(token);
      navigate({ name: 'terminal' });
      return;
    }
    window.location.href = `/token/${key}${chain !== 'base' ? `?chain=${chain}` : ''}`;
  }, [navigate, setActiveToken, tokens]);
}

const STATUS_STYLE = {
  target: { label: 'Target hit', className: 'bg-up/15 text-up border-up/40', icon: Check },
  stopped: { label: 'Stopped out', className: 'bg-down/15 text-down border-down/40', icon: Flag },
} as const;

export const ThesisCard: React.FC<{
  thesis: Thesis;
  showToken?: boolean;
  onChange?: (thesis: Thesis) => void;
  onRemove?: (id: string) => void;
}> = ({ thesis, showToken = false, onChange, onRemove }) => {
  const { activeToken, setActiveThesis, activeThesis, tokens } = useApp();
  const { wallet, ensureProfile, view } = useSocial();
  const openToken = useOpenToken();
  const [liking, setLiking] = useState(false);
  const [comments, setComments] = useState<ThesisComment[] | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bullish = thesis.stance === 'bullish';
  const performance = thesisPerformance(thesis);
  const status = thesisStatus(thesis);
  const isMine = wallet && thesis.author?.wallet === wallet;
  const onTerminal = view.name === 'terminal' && activeToken.address.toLowerCase() === thesis.tokenAddress;
  const onChart = onTerminal && activeThesis?.id === thesis.id;
  const logo = tokens.find((token) => token.address.toLowerCase() === thesis.tokenAddress)?.logo;

  const toggleLike = async () => {
    if (liking || !await ensureProfile()) return;
    setLiking(true);
    const optimistic = { ...thesis, liked: !thesis.liked, likeCount: thesis.likeCount + (thesis.liked ? -1 : 1) };
    onChange?.(optimistic);
    try {
      const result = await likeThesis(thesis.id, optimistic.liked);
      onChange?.({ ...optimistic, liked: result.liked, likeCount: result.likeCount });
    } catch {
      onChange?.(thesis);
    } finally {
      setLiking(false);
    }
  };

  const toggleComments = async () => {
    const next = !showComments;
    setShowComments(next);
    if (next && !comments) {
      try {
        setComments((await fetchComments(thesis.id)).comments);
      } catch {
        setComments([]);
      }
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || sending || !await ensureProfile()) return;
    setSending(true);
    setError(null);
    try {
      const { comment } = await postComment(thesis.id, draft);
      setComments((current) => [...(current ?? []), comment]);
      setDraft('');
      onChange?.({ ...thesis, commentCount: thesis.commentCount + 1 });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not post the comment.');
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (commentId: string) => {
    try {
      await deleteComment(thesis.id, commentId);
      setComments((current) => (current ?? []).filter((comment) => comment.id !== commentId));
      onChange?.({ ...thesis, commentCount: Math.max(0, thesis.commentCount - 1) });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not remove the comment.');
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this thesis?')) return;
    try {
      await deleteThesis(thesis.id);
      if (activeThesis?.id === thesis.id) setActiveThesis(null);
      onRemove?.(thesis.id);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not delete the thesis.');
    }
  };

  const showOnChart = () => {
    if (!onTerminal) {
      openToken(thesis.tokenAddress, thesis.chain);
      return;
    }
    if (onChart) {
      setActiveThesis(null);
      return;
    }
    setActiveThesis({
      id: thesis.id,
      tokenId: activeToken.id,
      tokenSymbol: thesis.tokenSymbol,
      title: thesis.title,
      author: thesis.author?.username ?? '',
      stance: thesis.stance,
      entryPriceUsd: thesis.entryPrice ?? thesis.priceAtPost ?? 0,
      targetPriceUsd: thesis.targetPrice ?? 0,
      stopLossUsd: thesis.stopPrice ?? 0,
      timeframe: thesis.timeframe,
      content: thesis.content,
      likes: thesis.likeCount,
      createdAt: Date.parse(thesis.createdAt),
    });
    document.getElementById('market-chart')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const share = async () => {
    const url = `${window.location.origin}/token/${thesis.tokenAddress}${thesis.chain !== 'base' ? `?chain=${thesis.chain}` : ''}#thesis-${thesis.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard can be blocked; nothing else to do.
    }
  };

  return (
    <article id={`thesis-${thesis.id}`} className={`thesis-card group relative overflow-hidden rounded-2xl border bg-panel transition hover:border-fg/15 ${onChart ? 'border-warn/60' : 'border-line'}`}>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${bullish ? 'bg-up' : 'bg-down'}`} />
      <div className="p-4 pl-5">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {thesis.author && <TraderLabel wallet={thesis.author.wallet} card={thesis.author} size={26} />}
          <span className="text-subtle">· {timeAgo(thesis.createdAt)}</span>
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-extrabold uppercase tracking-wide ${bullish ? 'border-up/40 bg-up/10 text-up' : 'border-down/40 bg-down/10 text-down'}`}>
            {bullish ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{thesis.stance}
          </span>
        </header>

        {showToken && (
          <button type="button" onClick={() => openToken(thesis.tokenAddress, thesis.chain)} className="mt-3 inline-flex items-center gap-2 rounded-full border border-line bg-raised/60 py-1 pl-1 pr-3 text-xs font-bold text-fg hover:border-accent/50">
            <OkxTokenLogo logo={logo} symbol={thesis.tokenSymbol} name={thesis.tokenName ?? thesis.tokenSymbol} size="xs" />
            ${thesis.tokenSymbol}
            {thesis.tokenName && <span className="max-w-[10rem] truncate font-medium text-muted">{thesis.tokenName}</span>}
          </button>
        )}

        <h3 className="mt-2.5 text-[0.98rem] font-extrabold leading-snug text-fg">{thesis.title}</h3>
        <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-fg-soft">{thesis.content}</p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Entry', thesis.entryPrice ?? thesis.priceAtPost, 'text-warn'],
            ['Target', thesis.targetPrice, 'text-up'],
            ['Stop', thesis.stopPrice, 'text-down'],
            ['Now', thesis.priceNow, 'text-fg'],
          ].map(([label, value, color]) => (
            <div key={label as string} className="rounded-xl border border-line/80 bg-sunken/50 px-2.5 py-1.5">
              <span className={`block text-[0.625rem] font-bold uppercase tracking-wider ${color}`}>{label as string}</span>
              <span className="font-mono text-xs font-bold text-fg">{formatPrice(value as number | null)}</span>
            </div>
          ))}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
          {performance !== null && (
            <span className={`rounded-full px-2 py-0.5 font-extrabold ${performance >= 0 ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
              {performance >= 0 ? '+' : ''}{performance.toFixed(1)}% since post
            </span>
          )}
          {status !== 'open' && (() => {
            const style = STATUS_STYLE[status];
            const Icon = style.icon;
            return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${style.className}`}><Icon className="h-3 w-3" />{style.label}</span>;
          })()}
          <span className="rounded-full bg-raised px-2 py-0.5 font-semibold text-muted">{TIMEFRAME_LABEL[thesis.timeframe]}</span>
        </div>

        <footer className="mt-3 flex items-center gap-1 border-t border-line/70 pt-2.5 text-xs">
          <button type="button" onClick={() => void toggleLike()} aria-pressed={thesis.liked} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold transition ${thesis.liked ? 'bg-pink-500/15 text-pink-400' : 'text-muted hover:bg-raised hover:text-fg'}`}>
            <Heart className={`h-4 w-4 ${thesis.liked ? 'fill-current' : ''}`} /> {thesis.likeCount}
          </button>
          <button type="button" onClick={() => void toggleComments()} aria-expanded={showComments} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold text-muted hover:bg-raised hover:text-fg">
            <MessageCircle className="h-4 w-4" /> {thesis.commentCount}
          </button>
          <button type="button" onClick={showOnChart} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold ${onChart ? 'bg-warn/15 text-warn' : 'text-muted hover:bg-raised hover:text-fg'}`}>
            <CandlestickChart className="h-4 w-4" /> <span className="hidden sm:inline">{onTerminal ? (onChart ? 'On chart' : 'Show on chart') : 'Open chart'}</span>
          </button>
          <button type="button" onClick={() => void share()} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold text-muted hover:bg-raised hover:text-fg" aria-label="Copy link">
            {copied ? <Check className="h-4 w-4 text-up" /> : <Link2 className="h-4 w-4" />}
          </button>
          {isMine && (
            <button type="button" onClick={() => void remove()} className="ml-auto rounded-full p-1.5 text-subtle hover:bg-down/10 hover:text-down" aria-label="Delete thesis"><Trash2 className="h-4 w-4" /></button>
          )}
        </footer>

        {showComments && (
          <div className="mt-2 space-y-2 rounded-xl bg-sunken/40 p-2.5">
            {comments === null && <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted" />}
            {comments?.length === 0 && <p className="text-center text-xs text-subtle">No comments yet. Start the discussion.</p>}
            {comments?.map((comment) => (
              <div key={comment.id} className="flex gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {comment.author && <TraderLabel wallet={comment.author.wallet} card={comment.author} size={18} />}
                    <span className="text-subtle">· {timeAgo(comment.createdAt)}</span>
                    {(wallet === comment.author?.wallet || isMine) && (
                      <button type="button" onClick={() => void removeComment(comment.id)} className="ml-auto text-subtle hover:text-down" aria-label="Delete comment"><Trash2 className="h-3 w-3" /></button>
                    )}
                  </div>
                  <p className="mt-0.5 whitespace-pre-line pl-6 text-fg-soft">{comment.content}</p>
                </div>
              </div>
            ))}
            <form onSubmit={send} className="flex items-center gap-2 pt-1">
              <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} placeholder="Add a comment…" className="min-w-0 flex-1 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-fg outline-none focus:border-accent" />
              <button type="submit" disabled={!draft.trim() || sending} className="rounded-full bg-accent p-2 text-black disabled:opacity-40" aria-label="Send comment">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
            </form>
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-xs text-down">{error}</p>}
      </div>
    </article>
  );
};
