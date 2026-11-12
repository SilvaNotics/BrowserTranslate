import { rpc, taskId } from '../../core/rpc';
import { PAGE_LIMITS, validPageConcurrency } from '../../core/page';
import {
  collectBlocks,
  readBlockText,
  readBlockLanguage,
  restoreBlocks,
  scanRoot,
  showTranslation,
  type Block,
} from './dom';
import { splitText, takeBatch, type PageChunk } from './batches';
import type { Segment } from '../../core/types';

export interface PageState {
  active: boolean;
  running: boolean;
  done: number;
  skipped: number;
  total: number;
  failed: number;
  error: string;
  mode: 'bilingual' | 'translation';
}

interface Job extends PageChunk {
  key: string;
  language?: string;
  blocks: Set<Block>;
  status: 'queued' | 'pending' | 'done' | 'failed';
  translation?: string;
  skipped: boolean;
}

export class PageController {
  state: PageState = {
    active: false,
    running: false,
    done: 0,
    skipped: 0,
    total: 0,
    failed: 0,
    error: '',
    mode: 'bilingual',
  };
  private blocks = new Set<Block>();
  private known = new WeakSet<HTMLElement>();
  private queue: Job[] = [];
  private jobs = new Map<string, Job>();
  private blockJobs = new Map<Block, Job[]>();
  private failed = new Set<Block>();
  private translated = new Map<string, string>();
  private skipped = new Set<Block>();
  // Memory only, bounded to at most 300 chunks for this page and translation context.
  private cache = new Map<string, { text: string; skipped: boolean }>();
  private context = '';
  private concurrency: number = PAGE_LIMITS.defaultConcurrency;
  private generation = 0;
  private observer?: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private dirtyRoots = new Set<HTMLElement>();
  private inFlight = new Map<string, Job[]>();

  constructor(private notify: (state: PageState) => void) {}

  configure({ concurrency, context }: { concurrency: number; context: string }) {
    if (!validPageConcurrency(concurrency)) throw new Error('整页翻译并发数需要是 1–6 的整数');
    if (context !== this.context) {
      this.restore();
      this.cache.clear();
      this.context = context;
    }
    this.concurrency = concurrency;
    this.pump();
  }

  private emit() {
    this.state = {
      ...this.state,
      total: this.blocks.size,
      done: this.translated.size + this.skipped.size,
      skipped: this.skipped.size,
      failed: this.failed.size,
    };
    this.notify(this.state);
  }

  start(mode = this.state.mode) {
    this.state = { ...this.state, active: true, running: true, error: '', mode };
    this.scan();
    if (!this.observer) {
      this.observer = new MutationObserver((records) => this.queueChanges(records));
      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['lang'],
      });
    }
  }

  private queueChanges(records: MutationRecord[]) {
    for (const record of records) {
      if (this.ownMutation(record)) continue;
      const target =
        record.target instanceof HTMLElement ? record.target : record.target.parentElement;
      if (!target) continue;
      if (target === document.documentElement) this.dirtyRoots.add(document.body);
      else if (
        target === document.body &&
        record.type === 'childList' &&
        [...record.addedNodes, ...record.removedNodes].every((node) => node instanceof Element)
      ) {
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement) this.dirtyRoots.add(node);
        // Removed blocks are pruned by refreshBlocks even without a connected scan root.
      } else this.dirtyRoots.add(scanRoot(target));
    }
    if (!records.some((record) => !this.ownMutation(record)) || this.timer !== undefined) return;
    // A bounded delay (not a resettable debounce) also progresses on live feeds.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const roots = [...this.dirtyRoots].filter((root) => root.isConnected);
      this.dirtyRoots.clear();
      if (this.state.running)
        this.scan(
          roots.filter((root) => !roots.some((other) => other !== root && other.contains(root))),
        );
    }, 150);
  }

  private write(action: () => void) {
    // Preserve page changes already queued, then discard only our synchronous writes.
    const records = this.observer?.takeRecords();
    if (records?.length) this.queueChanges(records);
    action();
    this.observer?.takeRecords();
  }

  private ownMutation(record: MutationRecord) {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest('[data-yijing-ui],[data-yijing-translation]')) return true;
    // Appending our translation must not cause another full DOM scan.
    const changed = [...record.addedNodes, ...record.removedNodes];
    return (
      changed.length > 0 &&
      changed.every(
        (node) =>
          node instanceof Element && node.matches('[data-yijing-ui],[data-yijing-translation]'),
      )
    );
  }

  private scan(roots = [document.body]) {
    this.refreshBlocks(roots);
    this.pump();
  }

  private forgetOrphan(job: Job) {
    if (!job.blocks.size && this.jobs.get(job.key) === job) this.jobs.delete(job.key);
  }

  private refreshBlocks(roots = [document.body]) {
    const recollect = new Set(roots);
    for (const block of this.blocks) {
      if (
        block.element.isConnected &&
        (!roots.some((root) => root.contains(block.element) || block.element.contains(root)) ||
          (readBlockText(block.element) === block.text &&
            readBlockLanguage(block.element, block.text) === block.language))
      )
        continue;
      // A mutation may be inside an inline child of the owning block (for
      // example a link inside a navigation span). Recollect the owner too.
      if (block.element.isConnected) recollect.add(block.element);
      this.write(() => restoreBlocks([block]));
      this.known.delete(block.element);
      this.translated.delete(block.id);
      this.skipped.delete(block);
      this.failed.delete(block);
      for (const job of this.blockJobs.get(block) ?? []) {
        job.blocks.delete(block);
        this.forgetOrphan(job);
      }
      this.blockJobs.delete(block);
      this.blocks.delete(block);
    }
    // Read layout once per new block, before inserting any translations.
    const scanRoots = [...recollect].filter((root) => root.isConnected);
    const added = scanRoots
      .filter((root) => !scanRoots.some((other) => other !== root && other.contains(root)))
      .flatMap((root) => collectBlocks(root, this.known))
      .map((block) => {
        const rect = block.element.getBoundingClientRect();
        return {
          block,
          visible: rect.bottom >= 0 && rect.top < innerHeight,
          distance: Math.abs(rect.top),
        };
      });
    added.sort((a, b) => Number(b.visible) - Number(a.visible) || a.distance - b.distance);
    for (const { block, visible } of added) {
      this.blocks.add(block);
      const language = block.language;
      const jobs = splitText(block.text).map((text) => {
        const key = JSON.stringify([language ?? '', text]);
        let job = this.jobs.get(key);
        if (!job) {
          const cached = this.cache.get(key);
          job = {
            id: taskId(),
            key,
            language,
            text,
            visible,
            blocks: new Set(),
            status: cached ? 'done' : 'queued',
            translation: cached?.text,
            skipped: cached?.skipped ?? false,
          };
          this.jobs.set(key, job);
          if (!cached) this.queue.push(job);
        }
        job.visible ||= visible;
        job.blocks.add(block);
        return job;
      });
      this.blockJobs.set(block, jobs);
      this.apply(block);
    }
    this.queue.sort((a, b) => Number(b.visible) - Number(a.visible));
  }

  private apply(block: Block) {
    if (!this.blocks.has(block) || !block.element.isConnected) return;
    const jobs = this.blockJobs.get(block)!;
    if (jobs.some((job) => job.status === 'failed')) this.failed.add(block);
    if (jobs.some((job) => job.translation === undefined)) return;
    if (
      readBlockText(block.element) !== block.text ||
      readBlockLanguage(block.element, block.text) !== block.language
    )
      return;
    if (jobs.every((job) => job.skipped)) {
      this.skipped.add(block);
      this.failed.delete(block);
      return;
    }
    const text = jobs.map((job) => job.translation).join('\n');
    this.translated.set(block.id, text);
    this.failed.delete(block);
    this.write(() => showTranslation(block, text, this.state.mode));
  }

  private pump() {
    this.queue = this.queue.filter((job) => {
      this.forgetOrphan(job);
      return job.status === 'queued' && job.blocks.size > 0;
    });
    while (this.state.running && this.inFlight.size < this.concurrency && this.queue.length) {
      const batch = takeBatch(this.queue);
      if (
        batch.some((job) =>
          [...job.blocks].some(
            (block) =>
              !block.element.isConnected ||
              readBlockText(block.element) !== block.text ||
              readBlockLanguage(block.element, block.text) !== block.language,
          ),
        )
      ) {
        // MutationObserver is debounced; recheck before sending queued page text.
        this.queue.unshift(...batch);
        this.refreshBlocks([
          ...new Set(batch.flatMap((job) => [...job.blocks].map((block) => block.element))),
        ]);
        this.queue = this.queue.filter((job) => job.blocks.size > 0);
        continue;
      }
      void this.run(batch);
    }
    this.emit();
  }

  private async run(batch: Job[]) {
    const id = taskId(),
      generation = this.generation;
    this.inFlight.set(id, batch);
    for (const job of batch) job.status = 'pending';
    try {
      const results = await rpc<Segment[]>({
        type: 'page:batch',
        id,
        segments: batch.map(({ id, text, language }) => ({
          id,
          text,
          ...(language ? { language } : {}),
        })),
      });
      if (generation !== this.generation || !this.state.active) return;
      const byId = new Map(results.map((result) => [result.id, result]));
      for (const job of batch) {
        const result = byId.get(job.id);
        const translation = result?.text;
        if (!translation?.trim()) throw new Error('整页翻译缺少段落，请重试。');
        job.translation = translation;
        job.skipped = result!.skipped === true;
        job.status = 'done';
        this.cache.set(job.key, { text: translation, skipped: job.skipped });
        if (this.cache.size > PAGE_LIMITS.cacheEntries)
          this.cache.delete(this.cache.keys().next().value!);
        for (const block of job.blocks) this.apply(block);
      }
    } catch (error) {
      if (generation === this.generation) {
        for (const job of batch) {
          if (job.status === 'done') continue;
          job.status = 'failed';
          for (const block of job.blocks) this.failed.add(block);
        }
        if (batch.some((job) => job.blocks.size > 0))
          this.state.error = error instanceof Error ? error.message : '翻译失败';
      }
    } finally {
      for (const job of batch) this.forgetOrphan(job);
      this.inFlight.delete(id);
      if (generation === this.generation) this.pump();
    }
  }

  retry() {
    for (const job of this.jobs.values()) {
      if (job.status !== 'failed' || !job.blocks.size) continue;
      job.status = 'queued';
      this.queue.push(job);
    }
    this.failed.clear();
    this.state.error = '';
    this.start();
  }

  mode(mode: PageState['mode']) {
    this.state.mode = mode;
    for (const block of this.blocks) {
      const text = this.translated.get(block.id);
      if (text) this.write(() => showTranslation(block, text, mode));
    }
    this.emit();
  }

  stop() {
    this.generation++;
    this.state.running = false;
    this.observer?.disconnect();
    this.observer = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dirtyRoots.clear();
    for (const batch of this.inFlight.values()) {
      for (const job of batch) job.status = 'queued';
      this.queue.unshift(...batch);
    }
    for (const id of this.inFlight.keys())
      void rpc({ type: 'cancel', id: taskId(), taskId: id }).catch(() => {});
    this.inFlight.clear();
    this.emit();
  }

  restore() {
    this.stop();
    restoreBlocks([...this.blocks]);
    this.blocks.clear();
    this.queue = [];
    this.jobs.clear();
    this.blockJobs.clear();
    this.failed.clear();
    this.translated.clear();
    this.skipped.clear();
    this.known = new WeakSet();
    this.state.active = false;
    this.state.error = '';
    this.emit();
  }
}
