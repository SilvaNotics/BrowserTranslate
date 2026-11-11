import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc, taskId } from '../core/rpc';
import type { Settings } from '../core/types';
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const current = useRef<Settings | undefined>(undefined),
    queue = useRef(Promise.resolve()),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const load = async () => {
      try {
        const s = await rpc<Settings>({ type: 'settings:get', id: taskId() });
        if (mounted.current) {
          current.current = s;
          setSettings(s);
        }
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : '读取设置失败');
      }
    };
    void load();
    const changed = (_changes: unknown, area: string) => {
      if (area === 'local') void queue.current.then(load);
    };
    chrome.storage.onChanged.addListener(changed);
    return () => {
      mounted.current = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  const update = useCallback((change: (s: Settings) => Settings): Promise<void> => {
    if (!current.current) return Promise.resolve();
    const previous = current.current,
      next = change(structuredClone(previous));
    current.current = next;
    setSettings(next);
    setError('');
    setSaving(true);
    const action = queue.current.then(async () => {
      try {
        await rpc<Settings>({ type: 'settings:save', id: taskId(), settings: next });
      } catch (e) {
        if (current.current === next) {
          current.current = previous;
          if (mounted.current) setSettings(previous);
        }
        if (mounted.current) setError(e instanceof Error ? e.message : '保存失败');
        throw e;
      } finally {
        if (current.current === next && mounted.current) setSaving(false);
      }
    });
    queue.current = action.catch(() => {});
    return action;
  }, []);
  return { settings, update, error, setError, saving };
}
