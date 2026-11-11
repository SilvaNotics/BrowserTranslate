import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, Copy, Globe2, LoaderCircle, Pin, RefreshCw, X } from 'lucide-react';
import { rpc, taskId } from '../core/rpc';
import type { DetailResult } from '../core/types';
export interface Result {
  token: string;
  original: string;
  translation: string;
  loading: boolean;
  error?: string;
  screenshot?: boolean;
  x: number;
  y: number;
  context?: string;
}
export function ResultCard({
  result,
  onClose,
  onTranslate,
}: {
  result: Result;
  onClose: () => void;
  onTranslate: (text: string) => void;
}) {
  const [pinned, setPinned] = useState(false),
    [copied, setCopied] = useState(false),
    [detail, setDetail] = useState<DetailResult>(),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(false),
    [error, setError] = useState(''),
    [original, setOriginal] = useState(result.original);
  const [position, setPosition] = useState({
    x: Math.max(12, Math.min(result.x, innerWidth - 400)),
    y: Math.max(12, Math.min(result.y, innerHeight - 260)),
  });
  const card = useRef<HTMLElement>(null);
  const detailTask = useRef<string | undefined>(undefined);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pinned) onClose();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [pinned, onClose]);
  useEffect(
    () => () => {
      if (detailTask.current)
        void rpc({ type: 'cancel', id: taskId(), taskId: detailTask.current });
    },
    [],
  );
  useEffect(() => {
    setOriginal(result.original);
  }, [result.original]);
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const resize = () =>
      setPosition((p) => ({
        x: Math.max(8, Math.min(p.x, innerWidth - el.offsetWidth - 8)),
        y: Math.max(
          8,
          Math.min(p.y, innerHeight - Math.min(el.offsetHeight, innerHeight - 16) - 8),
        ),
      }));
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);
  async function explain(useWeb = false) {
    setBusy(true);
    setOnline(useWeb);
    setDetail(undefined);
    setError('');
    const id = taskId();
    detailTask.current = id;
    try {
      const resultDetail = await rpc<DetailResult>({
        type: 'detail',
        id,
        text: original,
        context: result.context,
        online: useWeb,
      });
      if (detailTask.current === id) setDetail(resultDetail);
    } catch (e) {
      if (detailTask.current === id) setError(e instanceof Error ? e.message : '解释失败');
    } finally {
      if (detailTask.current === id) setBusy(false);
    }
  }
  return (
    <section
      ref={card}
      className="yj-result yj-panel"
      role="dialog"
      aria-label="翻译结果"
      style={{ left: position.x, top: position.y }}
    >
      <header
        className="yj-drag"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          const sx = e.clientX - position.x,
            sy = e.clientY - position.y;
          e.currentTarget.setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) =>
            setPosition({
              x: Math.max(
                8,
                Math.min(innerWidth - (card.current?.offsetWidth ?? 400) - 8, ev.clientX - sx),
              ),
              y: Math.max(
                8,
                Math.min(innerHeight - (card.current?.offsetHeight ?? 260) - 8, ev.clientY - sy),
              ),
            });
          const end = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', end);
          };
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', end, { once: true });
        }}
      >
        <span className="yj-brand-small">
          译<span>境</span>
        </span>
        <span className="yj-caption">{result.screenshot ? '截图翻译' : '划词翻译'}</span>
        <div className="yj-spacer" />
        <button
          className={pinned ? 'yj-icon active' : 'yj-icon'}
          aria-label={pinned ? '取消固定' : '固定浮窗'}
          aria-pressed={pinned}
          onClick={() => setPinned(!pinned)}
        >
          <Pin size={15} />
        </button>
        <button className="yj-icon" aria-label="关闭翻译" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="yj-result-scroll">
        <label className="yj-eyebrow">原文{result.screenshot ? ' · 可修正' : ''}</label>
        {result.screenshot ? (
          <textarea
            aria-label="识别原文"
            className="yj-original-edit"
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
          />
        ) : (
          <p className="yj-original">{result.original}</p>
        )}
        <div className="yj-divider" />
        <label className="yj-eyebrow">译文</label>
        <div className="yj-translated" aria-live="polite">
          {result.loading ? (
            <span className="yj-loading">
              <LoaderCircle size={16} />
              {result.screenshot && !result.original ? '正在识别文字…' : '正在翻译…'}
            </span>
          ) : (
            result.translation
          )}
        </div>
        {result.error && (
          <p className="yj-error" role="alert">
            {result.error}
          </p>
        )}
        {(busy || detail || error) && (
          <div className="yj-detail">
            <div className="yj-detail-heading">
              <BookOpen size={16} />
              语境词典
            </div>
            {busy && (
              <p className="yj-loading">
                <LoaderCircle size={15} />
                {online ? '正在搜索资料并解释…' : '正在解释…'}
              </p>
            )}
            {error && <p className="yj-error">{error}</p>}
            {detail && (
              <>
                <p className="yj-detail-text">{detail.text}</p>
                <p className={detail.warning ? 'yj-warning' : 'yj-verification'}>
                  {detail.verified
                    ? '已检索相关网络资料 · 请结合来源判断'
                    : detail.warning || '模型解释 · 未联网搜索'}
                </p>
                {detail.sources.map((s) => (
                  <a
                    className="yj-source"
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    key={s.id}
                  >
                    [{s.id}] {s.title}
                    <span>{new URL(s.url).hostname} ↗</span>
                  </a>
                ))}
                {online && !detail.verified && (
                  <button className="yj-link" onClick={() => void explain(true)}>
                    重试联网查证
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <footer>
        <button
          className="yj-secondary"
          onClick={() =>
            void navigator.clipboard
              .writeText(result.translation)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => setError('复制失败，请手动选择译文复制。'))
          }
          disabled={!result.translation}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? '已复制' : '复制'}
        </button>
        {(result.screenshot || result.error) && (
          <button
            className="yj-secondary"
            disabled={!original.trim() || result.loading}
            onClick={() => {
              setDetail(undefined);
              onTranslate(original);
            }}
          >
            <RefreshCw size={14} />
            重译
          </button>
        )}
        <button
          className="yj-primary"
          disabled={busy || !original.trim() || result.loading}
          onClick={() => void explain()}
        >
          <BookOpen size={14} />
          详细
        </button>
        <button
          className="yj-secondary"
          aria-label="联网搜索"
          title="联网搜索并解释"
          disabled={busy || !original.trim() || result.loading}
          onClick={() => void explain(true)}
        >
          <Globe2 size={16} />
        </button>
      </footer>
    </section>
  );
}
