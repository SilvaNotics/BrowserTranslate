import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Languages, LoaderCircle, Play, RotateCcw, Square, X } from 'lucide-react';
import { rpc, taskId } from '../core/rpc';
import type { PublicSettings, Region } from '../core/types';
import { bindSelectionShortcut } from './shortcuts';
import { PageController, type PageState } from './page/controller';
import { ResultCard, type Result } from './ResultCard';
export function ContentApp({ host }: { host: HTMLElement }) {
  const [settings, setSettings] = useState<PublicSettings>(),
    [result, setResult] = useState<Result>(),
    [toast, setToast] = useState(''),
    [capture, setCapture] = useState(false),
    [rect, setRect] = useState<Region>(),
    [menu, setMenu] = useState(false);
  const [ball, setBall] = useState({ right: 12, top: innerHeight * 0.45 });
  const [pageState, setPageState] = useState<PageState>({
    active: false,
    running: false,
    done: 0,
    skipped: 0,
    total: 0,
    failed: 0,
    error: '',
    mode: 'bilingual',
  });
  const controller = useRef<PageController | null>(null),
    currentTask = useRef<string | undefined>(undefined),
    start = useRef<{ x: number; y: number } | undefined>(undefined),
    moved = useRef(false),
    config = useRef(settings);
  const latestResult = useRef(result);
  latestResult.current = result;
  config.current = settings;
  if (!controller.current) controller.current = new PageController(setPageState);
  useEffect(() => {
    if (!settings) return;
    const provider = settings.providers.find((p) => p.id === settings.translation?.providerId);
    controller.current?.configure({
      concurrency: settings.pageConcurrency,
      context: JSON.stringify([settings.targetLanguage, settings.translation, provider?.baseUrl]),
    });
  }, [settings]);
  const close = useCallback(() => {
    if (currentTask.current)
      void rpc({ type: 'cancel', id: taskId(), taskId: currentTask.current }).catch(() => {});
    currentTask.current = undefined;
    setResult(undefined);
  }, []);
  const translate = useCallback(
    async (text: string, x: number, y: number, screenshot = false, context?: string) => {
      if (currentTask.current)
        void rpc({ type: 'cancel', id: taskId(), taskId: currentTask.current }).catch(() => {});
      const id = taskId();
      currentTask.current = id;
      setResult({
        token: id,
        original: text,
        translation: '',
        loading: true,
        x,
        y,
        screenshot,
        context,
      });
      try {
        const translation = await rpc<string>({ type: 'translate', id, text });
        if (currentTask.current === id)
          setResult((r) => (r ? { ...r, translation, loading: false } : r));
      } catch (e) {
        if (currentTask.current === id)
          setResult((r) =>
            r
              ? {
                  ...r,
                  loading: false,
                  error: e instanceof Error ? e.message : '翻译失败，请重试。',
                }
              : r,
          );
      }
    },
    [],
  );
  useEffect(() => {
    void rpc<PublicSettings>({ type: 'settings:public', id: taskId() })
      .then(setSettings)
      .catch(() => {});
    const listener = (
      message: { type: string; settings?: PublicSettings; id?: string; mode?: string },
      _sender: unknown,
      respond: (value: unknown) => void,
    ) => {
      if (message.type === 'settings:changed' && message.settings) {
        const next = message.settings,
          previous = config.current;
        const languageChanged =
          previous &&
          (previous.targetLanguage !== next.targetLanguage ||
            JSON.stringify(previous.translation) !== JSON.stringify(next.translation));
        setSettings(next);
        if (!next.features.page || languageChanged) controller.current?.restore();
        if (!next.features.screenshot) {
          setCapture(false);
          if (latestResult.current?.screenshot) close();
        }
        if (
          (!next.features.selection && latestResult.current && !latestResult.current.screenshot) ||
          languageChanged
        )
          close();
      }
      if (message.type === 'capture:begin') {
        if (config.current?.features.screenshot) {
          close();
          setMenu(false);
          setCapture(true);
          setRect(undefined);
          respond(true);
        } else respond(false);
      }
      if (message.type === 'capture:captured' && message.id && message.id === currentTask.current) {
        host.style.visibility = '';
        setResult({
          token: message.id,
          original: '',
          translation: '',
          loading: true,
          screenshot: true,
          x: 24,
          y: 90,
        });
        setToast(
          message.mode === 'vision' ? '正在通过视觉模型识别文字…' : '正在本地识别中英文文字…',
        );
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    const clean = bindSelectionShortcut(document, () => {
      if (!config.current?.features.selection) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;
      const node = selection.anchorNode?.parentElement;
      if (node?.closest('input,textarea,[contenteditable], [data-yijing-ui]')) return;
      const text = selection.toString().trim();
      if (!text || text.length > 20000) return;
      const bounds = selection.getRangeAt(0).getBoundingClientRect();
      void translate(
        text,
        bounds.left,
        bounds.bottom + 10,
        false,
        node?.textContent?.slice(0, 1500),
      );
    });
    const key = (e: KeyboardEvent) => {
      if (!e.isTrusted) return;
      if (e.key === 'Escape') {
        setCapture(false);
        setRect(undefined);
        setMenu(false);
      }
      if (
        e.ctrlKey &&
        e.code === 'NumpadMultiply' &&
        !e.repeat &&
        config.current?.features.screenshot
      ) {
        e.preventDefault();
        close();
        setMenu(false);
        setCapture(true);
        setRect(undefined);
      }
    };
    document.addEventListener('keydown', key, true);
    const onResize = () => {
      setCapture(false);
      setBall((p) => ({ ...p, top: Math.min(p.top, innerHeight - 60) }));
    };
    window.addEventListener('resize', onResize);
    const onPageHide = () => {
      controller.current?.restore();
      close();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clean();
      chrome.runtime.onMessage.removeListener(listener);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pagehide', onPageHide);
      controller.current?.restore();
      close();
    };
  }, [close, translate]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!capture) return;
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener('wheel', prevent, { passive: false, capture: true });
    document.addEventListener('touchmove', prevent, { passive: false, capture: true });
    return () => {
      document.removeEventListener('wheel', prevent, true);
      document.removeEventListener('touchmove', prevent, true);
    };
  }, [capture]);
  async function recognize(region: Region) {
    setCapture(false);
    setRect(undefined);
    if (region.width < 8 || region.height < 8) {
      setToast('选区太小，请重新框选。');
      return;
    }
    const scroll = { x: scrollX, y: scrollY };
    const id = taskId();
    currentTask.current = id;
    host.style.visibility = 'hidden';
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const recognized = await rpc<string>({ type: 'capture:recognize', id, region });
      if (currentTask.current !== id) return;
      if (
        innerWidth !== region.viewportWidth ||
        innerHeight !== region.viewportHeight ||
        scroll.x !== scrollX ||
        scroll.y !== scrollY
      )
        throw new Error('页面位置或大小已变化，请重新截图。');
      if (!recognized?.trim() || recognized.trim() === '[EMPTY]')
        throw new Error('未识别到文字，请重新框选或切换视觉模型。');
      host.style.visibility = '';
      setToast('');
      await translate(recognized, region.x, region.y + region.height + 10, true);
    } catch (e) {
      if (currentTask.current === id) {
        const error = e instanceof Error ? e.message : '识别失败，请重试。';
        setToast(error);
        setResult((r) => (r?.token === id ? { ...r, loading: false, error } : r));
      }
    } finally {
      host.style.visibility = '';
    }
  }
  const beginPage = () => {
    if (!settings?.translation) {
      setToast('请先在扩展设置中添加供应商并选择翻译模型。');
      return;
    }
    controller.current?.start(settings.pageMode);
    setMenu(true);
  };
  return (
    <div className="yj-root" data-theme={settings?.theme ?? 'system'}>
      {settings?.features.page && (
        <button
          className="yj-ball"
          aria-label="整页翻译"
          aria-expanded={menu}
          aria-controls="yj-page-menu"
          data-active={pageState.active}
          aria-busy={pageState.running && pageState.done < pageState.total}
          title="译境 · 整页翻译"
          style={{ right: ball.right, top: ball.top }}
          onPointerDown={(e) => {
            moved.current = false;
            const origin = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
            const move = (ev: PointerEvent) => {
              if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > 6)
                moved.current = true;
              if (moved.current)
                setBall({
                  right: Math.max(6, Math.min(innerWidth - 48, innerWidth - ev.clientX - 21)),
                  top: Math.max(8, Math.min(innerHeight - 50, ev.clientY - 21)),
                });
            };
            const up = (ev: PointerEvent) => {
              document.removeEventListener('pointermove', move);
              if (moved.current)
                setBall((p) => ({
                  ...p,
                  right: ev.clientX < innerWidth / 2 ? innerWidth - 54 : 12,
                }));
            };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up, { once: true });
          }}
          onClick={() => {
            if (moved.current) return;
            if (!pageState.active) beginPage();
            else setMenu(!menu);
          }}
        >
          {pageState.running && pageState.done < pageState.total ? (
            <LoaderCircle size={20} className="yj-spin" />
          ) : (
            <Languages size={21} strokeWidth={1.8} />
          )}
        </button>
      )}
      {menu && settings?.features.page && (
        <section
          id="yj-page-menu"
          className="yj-menu yj-panel"
          style={{
            right: Math.max(8, Math.min(ball.right + 52, innerWidth - 304)),
            top: Math.max(8, Math.min(ball.top, innerHeight - 290)),
          }}
          role="dialog"
          aria-label="整页翻译控制"
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h3>阅读，换一种语言</h3>
            <div className="yj-spacer" />
            <button className="yj-icon" aria-label="关闭整页菜单" onClick={() => setMenu(false)}>
              <X size={16} />
            </button>
          </div>
          <p aria-live="polite">
            已处理 {pageState.done} / {pageState.total} 段
            {pageState.skipped ? ' · ' + pageState.skipped + ' 段已是目标语言' : ''}
            {pageState.failed ? ' · ' + pageState.failed + ' 段失败' : ''}
            {pageState.running && pageState.done === pageState.total ? ' · 等待新内容' : ''}
          </p>
          <div className="yj-progress">
            <div
              style={{
                width: (pageState.total ? (pageState.done / pageState.total) * 100 : 0) + '%',
              }}
            />
          </div>
          <div className="yj-mode">
            <button
              aria-pressed={pageState.mode === 'bilingual'}
              onClick={() => controller.current?.mode('bilingual')}
            >
              双语对照
            </button>
            <button
              aria-pressed={pageState.mode === 'translation'}
              onClick={() => controller.current?.mode('translation')}
            >
              仅译文
            </button>
          </div>
          {pageState.error && <p className="yj-error">{pageState.error}</p>}
          <div className="yj-menu-actions">
            {pageState.running ? (
              <button className="yj-secondary" onClick={() => controller.current?.stop()}>
                <Square size={12} />
                停止
              </button>
            ) : (
              <button
                className="yj-secondary"
                onClick={() => controller.current?.start(pageState.mode)}
              >
                <Play size={12} />
                继续
              </button>
            )}
            {pageState.failed > 0 && (
              <button className="yj-secondary" onClick={() => controller.current?.retry()}>
                重试失败段落
              </button>
            )}
            <button
              className="yj-secondary"
              onClick={() => {
                controller.current?.restore();
                setMenu(false);
              }}
            >
              <RotateCcw size={13} />
              恢复原文
            </button>
            <button
              className="yj-secondary"
              disabled={!settings.features.screenshot}
              onClick={() => {
                setMenu(false);
                setCapture(true);
              }}
            >
              <Camera size={13} />
              截图
            </button>
          </div>
        </section>
      )}
      {result && (
        <ResultCard
          key={result.token}
          result={result}
          onClose={close}
          onTranslate={(text) =>
            void translate(text, result.x, result.y, result.screenshot, result.context)
          }
        />
      )}
      {toast && (
        <div className="yj-toast yj-panel" role="status">
          {toast}
        </div>
      )}
      {capture && (
        <div
          className="yj-overlay"
          role="dialog"
          aria-label="框选截图区域"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            start.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
            setRect(undefined);
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            setRect({
              x: Math.min(start.current.x, e.clientX),
              y: Math.min(start.current.y, e.clientY),
              width: Math.abs(e.clientX - start.current.x),
              height: Math.abs(e.clientY - start.current.y),
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
            });
          }}
          onPointerUp={(e) => {
            const begin = start.current;
            start.current = undefined;
            if (!begin) return;
            void recognize({
              x: Math.min(begin.x, e.clientX),
              y: Math.min(begin.y, e.clientY),
              width: Math.abs(e.clientX - begin.x),
              height: Math.abs(e.clientY - begin.y),
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
            });
          }}
        >
          <div className="yj-capture-tip">
            拖动框选文字 · {settings?.ocrMode === 'vision' ? '视觉模型识别' : '本地中英文 OCR'} ·
            Esc 取消
          </div>
          {rect && (
            <div
              className="yj-selection"
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            />
          )}
        </div>
      )}
    </div>
  );
}
