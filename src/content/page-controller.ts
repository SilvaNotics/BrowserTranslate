import { rpc, taskId } from '../core/rpc';
import {
  collectBlocks,
  readBlockText,
  restoreBlocks,
  showTranslation,
  type Block,
} from './page-dom';
import type { Segment } from '../core/types';
export interface PageState {
  active: boolean;
  running: boolean;
  done: number;
  total: number;
  failed: number;
  error: string;
  mode: 'bilingual' | 'translation';
}
export class PageController {
  state: PageState = {
    active: false,
    running: false,
    done: 0,
    total: 0,
    failed: 0,
    error: '',
    mode: 'bilingual',
  };
  private blocks: Block[] = [];
  private known = new WeakSet<HTMLElement>();
  private queue: Block[] = [];
  private failed = new Set<Block>();
  private pending = new Set<string>();
  private translated = new Map<string, string>();
  private generation = 0;
  private observer?: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight = new Map<string, Block[]>();
  constructor(private notify: (state: PageState) => void) {}
  private emit() {
    this.state = {
      ...this.state,
      total: this.blocks.length,
      done: this.translated.size,
      failed: this.failed.size,
    };
    this.notify(this.state);
  }
  start(mode = this.state.mode) {
    this.state = { ...this.state, active: true, running: true, error: '', mode };
    this.scan();
    if (!this.observer) {
      this.observer = new MutationObserver((records) => {
        if (
          records.every((r) =>
            (r.target instanceof Element ? r.target : r.target.parentElement)?.closest(
              '[data-yijing-ui],[data-yijing-translation]',
            ),
          )
        )
          return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          if (this.state.running) this.scan();
        }, 400);
      });
      this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }
  private scan() {
    const retired = new Set(
      this.blocks.filter(
        (block) => !block.element.isConnected || readBlockText(block.element) !== block.text,
      ),
    );
    for (const block of retired) {
      restoreBlocks([block]);
      this.known.delete(block.element);
      this.translated.delete(block.id);
      this.failed.delete(block);
    }
    this.blocks = this.blocks.filter((block) => !retired.has(block));
    this.queue = this.queue.filter((block) => !retired.has(block));
    const added = collectBlocks(document.body, this.known);
    added.sort((a, b) => {
      const ar = a.element.getBoundingClientRect(),
        br = b.element.getBoundingClientRect();
      const av = ar.bottom >= 0 && ar.top < innerHeight,
        bv = br.bottom >= 0 && br.top < innerHeight;
      return Number(bv) - Number(av) || Math.abs(ar.top) - Math.abs(br.top);
    });
    this.blocks.push(...added);
    this.queue.push(...added);
    this.emit();
    this.pump();
  }
  private pump() {
    while (this.state.running && this.pending.size < 2 && this.queue.length) {
      const batch: Block[] = [];
      let size = 0;
      while (this.queue.length && batch.length < 6) {
        const next = this.queue[0]!;
        if (batch.length && size + next.text.length > 6000) break;
        this.queue.shift();
        if (!next.element.isConnected || !this.blocks.includes(next)) continue;
        batch.push(next);
        size += next.text.length;
      }
      if (batch.length) void this.run(batch);
    }
    this.emit();
  }
  private async run(batch: Block[]) {
    const id = taskId(),
      generation = this.generation;
    this.pending.add(id);
    this.inFlight.set(id, batch);
    try {
      const results = await rpc<Segment[]>({
        type: 'page:batch',
        id,
        segments: batch.map(({ id, text }) => ({ id, text })),
      });
      if (generation !== this.generation || !this.state.active) return;
      for (const result of results) {
        const block = batch.find((b) => b.id === result.id);
        if (!block || !block.element.isConnected || !this.blocks.includes(block)) continue;
        if (readBlockText(block.element) !== block.text) {
          this.failed.add(block);
          continue;
        }
        this.translated.set(block.id, result.text);
        this.failed.delete(block);
        showTranslation(block, result.text, this.state.mode);
      }
    } catch (error) {
      if (generation === this.generation) {
        batch.filter((b) => this.blocks.includes(b)).forEach((b) => this.failed.add(b));
        this.state.error = error instanceof Error ? error.message : '翻译失败';
      }
    } finally {
      this.pending.delete(id);
      this.inFlight.delete(id);
      if (generation === this.generation) this.pump();
    }
  }
  retry() {
    for (const block of this.failed) {
      block.text = readBlockText(block.element);
      this.queue.push(block);
    }
    this.failed.clear();
    this.state.error = '';
    this.state.running = true;
    this.pump();
  }
  mode(mode: 'bilingual' | 'translation') {
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
    for (const batch of this.inFlight.values()) this.queue.unshift(...batch);
    this.inFlight.clear();
    for (const id of this.pending) void rpc({ type: 'cancel', id: taskId(), taskId: id });
    this.pending.clear();
    this.emit();
  }
  restore() {
    this.stop();
    restoreBlocks(this.blocks);
    this.blocks = [];
    this.queue = [];
    this.failed.clear();
    this.translated.clear();
    this.known = new WeakSet();
    this.state.active = false;
    this.state.error = '';
    this.emit();
  }
}
