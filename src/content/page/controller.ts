import { rpc, taskId } from '../../core/rpc';
import { PAGE_LIMITS, validPageConcurrency } from '../../core/page';
import { collectBlocks, readBlockText, restoreBlocks, showTranslation, type Block } from './dom';
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
      this.observer = new MutationObserver((records) => {
        if (records.every((r) => this.ownMutation(r))) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          if (this.state.running) this.scan();
        }, 150);
      });
      this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  private ownMutation(record: MutationRecord) {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest('[data-yijing-ui],[data-yijing-translation]')) return true;
    // Appending our translation must not cause another full DOM scan.
    const changed = [...record.addedNodes, ...record.removedNodes];
    return (
      changed.length > 0 &&
      changed.every((node) => node instanceof Element && node.matches('[data-yijing-translation]'))
    );
  }

  private scan() {
    this.refreshBlocks();
    this.pump();
  }

  private forgetOrphan(job: Job) {
    if (!job.blocks.size && this.jobs.get(job.text) === job) this.jobs.delete(job.text);
  }

  private refreshBlocks() {
    for (const block of this.blocks) {
      if (block.element.isConnected && readBlockText(block.element) === block.text) continue;
      restoreBlocks([block]);
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
    const added = collectBlocks(document.body, this.known).map((block) => {
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
      const jobs = splitText(block.text).map((text) => {
        let job = this.jobs.get(text);
        if (!job) {
          const cached = this.cache.get(text);
          job = {
            id: taskId(),
            text,
            visible,
            blocks: new Set(),
            status: cached ? 'done' : 'queued',
            translation: cached?.text,
            skipped: cached?.skipped ?? false,
          };
          this.jobs.set(text, job);
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
    if (readBlockText(block.element) !== block.text) return;
    if (jobs.every((job) => job.skipped)) {
      this.skipped.add(block);
      this.failed.delete(block);
      return;
    }
    const text = jobs.map((job) => job.translation).join('\n');
    this.translated.set(block.id, text);
    this.failed.delete(block);
    showTranslation(block, text, this.state.mode);
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
            (block) => !block.element.isConnected || readBlockText(block.element) !== block.text,
          ),
        )
      ) {
        // MutationObserver is debounced; recheck before sending queued page text.
        this.queue.unshift(...batch);
        this.refreshBlocks();
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
        segments: batch.map(({ id, text }) => ({ id, text })),
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
        this.cache.set(job.text, { text: translation, skipped: job.skipped });
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
      if (text) showTranslation(block, text, mode);
    }
    this.emit();
  }

  stop() {
    this.generation++;
    this.state.running = false;
    this.observer?.disconnect();
    this.observer = undefined;
    clearTimeout(this.timer);
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
