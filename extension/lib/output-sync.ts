import { SERVICE, type Caption } from './types';
type Context = { id: string; token: string; enabled: boolean; dirty: boolean; lost?: boolean };
type Update = { context: Context; id: string; revision: number; text: string };

/** Persist Chinese independently: a disk failure never rejects UI delivery. */
export class OutputSync {
  private contexts = new Map<string, Context>();
  private current?: Context;
  private pending = new Map<string, Update>();
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  constructor(private status: (failed: boolean) => void) {}
  begin(id: string, token: string, enabled: boolean) {
    this.prune();
    this.current = { id, token, enabled, dirty: false };
    this.contexts.set(id, this.current);
  }
  configure(enabled: boolean) {
    if (!this.current || this.current.enabled === enabled) return;
    this.current.enabled = enabled; this.current.dirty = true;
    if (!enabled) for (const [key, update] of this.pending) {
      if (update.context === this.current) this.pending.delete(key);
    }
    clearTimeout(this.timer); this.timer = undefined;
    this.schedule(0);
  }
  enqueue(caption: Caption) {
    const context = this.contexts.get(caption.sessionId);
    if (!context?.enabled || context.lost || !caption.final || !caption.translation || caption.translationRevision !== caption.revision) return;
    if (this.pending.size >= 5000) { this.status(true); return; }
    this.pending.set(`${caption.sessionId}/${caption.id}`, { context, id: caption.id, revision: caption.revision, text: caption.translation });
    this.schedule(250);
  }
  private schedule(delay: number) {
    if (this.running || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, delay);
  }
  private async drain() {
    this.running = true;
    let retry = false;
    try {
      const config = [...this.contexts.values()].find(context => context.dirty);
      const context = config || this.pending.values().next().value?.context;
      if (!context) return;
      const enabled = context.enabled;
      const batch = config ? [] : [...this.pending.values()].filter(update => update.context === context).slice(0, 100);
      const response = await fetch(`${SERVICE}/outputs/${context.id}/${config ? 'settings' : 'translations'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${context.token}` },
        body: JSON.stringify(config ? { enabled } : { updates: batch.map(({ id, revision, text }) => ({ id, revision, text })) }),
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 404) {
        context.lost = true; context.dirty = false;
        for (const [key, update] of this.pending) if (update.context === context) this.pending.delete(key);
        this.status(true); return;
      }
      if (!response.ok) throw new Error('Output unavailable');
      if (config) { if (enabled === context.enabled) context.dirty = false; }
      else for (const update of batch) {
        const key = `${context.id}/${update.id}`;
        if (this.pending.get(key) === update) this.pending.delete(key);
      }
      this.status(false);
    } catch { this.status(true); retry = true; }
    finally {
      this.running = false;
      this.prune();
      if (this.pending.size || [...this.contexts.values()].some(context => context.dirty)) this.schedule(retry ? 3000 : 0);
    }
  }
  private prune() {
    for (const [id, context] of this.contexts) if (context !== this.current && !context.dirty &&
      ![...this.pending.values()].some(update => update.context === context)) this.contexts.delete(id);
  }
}
