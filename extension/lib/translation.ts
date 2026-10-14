import { SERVICE, type Caption } from './types';
import { errorName, recordDiagnostic } from './diagnostics';

type TranslatorInstance = { translate(text: string, options?: { signal: AbortSignal }): Promise<string>; destroy(): void };

/** Also bounds APIs that fail to honour AbortSignal; late results are ignored. */
function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, external?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(external?.reason ?? new DOMException('操作已取消', 'AbortError'));
  if (external?.aborted) cancel();
  external?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('翻译请求超时', 'TimeoutError')), timeoutMs);
  return new Promise<T>((resolve, reject) => {
    if (controller.signal.aborted) { reject(controller.signal.reason); return; }
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    try { Promise.resolve(work(controller.signal)).then(resolve, reject); } catch (error) { reject(error); }
  }).finally(() => { clearTimeout(timer); external?.removeEventListener('abort', cancel); });
}
export function finalTranslation(text: string, incomplete = false): string {
  const cleaned = text.trim().replace(/,\s*(?=\p{Script=Han})|(?<=\p{Script=Han}),\s*/gu, '，');
  if (!cleaned) throw new Error('翻译返回了空结果，英文字幕已保留。');
  if (incomplete) return cleaned.replace(/[。.!?！？…]+$/, '') + '…';
  if (cleaned.endsWith('.')) return cleaned.slice(0, -1) + '。';
  return /[。！？!?…][”’"」]*$/.test(cleaned) ? cleaned : cleaned + '。';
}
type TranslatorFactory = {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal; monitor?: (monitor: EventTarget) => void }): Promise<TranslatorInstance>;
};
declare global { interface Window { Translator?: TranslatorFactory } }

export class LocalTranslator {
  private instance?: TranslatorInstance;
  private preparing?: Promise<void>;
  private preparation?: AbortController;
  private generation = 0;
  get ready() { return Boolean(this.instance); }

  async availability(): Promise<string> {
    if (!window.Translator) return 'unsupported';
    return bounded(() => window.Translator!.availability({ sourceLanguage: 'en', targetLanguage: 'zh' }), 5000);
  }

  prepare(onProgress: (value: number) => void, signal?: AbortSignal): Promise<void> {
    if (this.instance) return Promise.resolve();
    if (this.preparing) return this.preparing;
    if (!window.Translator) return Promise.reject(new Error('这版 Chrome 未提供本地翻译 API。可以先使用英文字幕，或主动选择 DeepSeek。'));
    const generation = this.generation;
    const preparation = new AbortController();
    this.preparation = preparation;
    // Start create synchronously while a button's user activation is available.
    const pending = bounded(abort => window.Translator!.create({ sourceLanguage: 'en', targetLanguage: 'zh', signal: abort, monitor(monitor) {
      monitor.addEventListener('downloadprogress', event => onProgress((event as Event & { loaded: number }).loaded));
    } }).then(instance => {
      if (abort.aborted || generation !== this.generation) {
        instance.destroy(); throw new DOMException('操作已取消', 'AbortError');
      }
      this.instance = instance;
      recordDiagnostic('translation', 'chrome_ready');
    }), 180000, signal ? AbortSignal.any([signal, preparation.signal]) : preparation.signal);
    this.preparing = pending;
    void pending.finally(() => {
      if (this.preparing === pending) { this.preparing = undefined; this.preparation = undefined; }
    }).catch(() => {});
    return pending;
  }

  async translate(text: string, signal?: AbortSignal) {
    return bounded(async abort => {
      if (!this.instance) {
        if (await this.availability() !== 'available') throw new DOMException('请在设置中准备 Chrome 翻译语言包。', 'NotSupportedError');
        await this.prepare(() => {}, abort);
      }
      if (abort.aborted) throw abort.reason;
      const instance = this.instance!;
      try { return await bounded(cancel => instance.translate(text, { signal: cancel }), 8000, abort); }
      catch (error) {
        if (this.instance === instance) { this.instance = undefined; try { instance.destroy(); } catch { /* Chrome may already have disconnected. */ } }
        recordDiagnostic('translation', 'chrome_invalidated', { errorName: errorName(error) });
        throw error;
      }
    }, 15000, signal);
  }

  destroy() {
    this.generation++; this.preparation?.abort(); this.preparing = undefined; this.preparation = undefined;
    const instance = this.instance; this.instance = undefined;
    try { instance?.destroy(); } catch { /* Already disconnected. */ }
  }
}

export async function serviceTranslate(text: string, token: string, context: string[], provider: 'offline' | 'deepseek', signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${SERVICE}/translate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, context, provider }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(22000)]) : AbortSignal.timeout(22000),
  });
  if (!response.ok) throw new Error(provider === 'offline' ? '本机离线翻译未就绪或正忙，请运行 setup.ps1 并重启服务。' : response.status === 503 ? '尚未配置 DeepSeek 密钥，请在项目 .env 中填写后重启服务。' : 'DeepSeek 翻译失败，请检查服务、密钥及网络。');
  const result = await response.json();
  return result.text;
}

export type TranslationStatus = { pending: number; failed: number; retrying: number; running: boolean };
type Job = { caption: Caption; attempts: number; nextAt: number; failed: boolean; result?: string };
type QueueOptions = { timeoutMs?: number; retryDelays?: number[]; onChange?: (status: TranslationStatus) => void };
/** Settled sentences publish once. Failed jobs remain available for repair. */
export class TranslationQueue {
  private pending = new Map<string, Job>();
  private generation = 0;
  private active?: { controller: AbortController; key: string };
  private timer?: ReturnType<typeof setTimeout>;
  private submitted = new Set<string>();
  constructor(private translate: (caption: Caption, signal: AbortSignal) => Promise<string>,
    private deliver: (caption: Caption, text: string) => void | Promise<void>,
    private failure: (error: unknown) => void, private options: QueueOptions = {}) {}

  get status(): TranslationStatus {
    const jobs = [...this.pending.values()];
    return { pending: jobs.length, failed: jobs.filter(job => job.failed).length,
      retrying: jobs.filter(job => job.attempts > 0 && !job.failed).length, running: Boolean(this.active) };
  }
  private changed() { this.options.onChange?.(this.status); }

  enqueue(caption: Caption) {
    if (!caption.final || !caption.text.trim() || caption.translation) return;
    const key = `${caption.sessionId}/${caption.id}`;
    if (this.submitted.has(key)) return;
    if (this.pending.has(key)) return;
    if (this.pending.size >= 5000) {
      this.failure(new Error('翻译队列已满，请先恢复翻译。英文转录仍继续。')); return;
    }
    this.pending.set(key, { caption, attempts: 0, nextAt: 0, failed: false });
    this.changed(); this.schedule();
  }

  retryFailed() {
    for (const job of this.pending.values()) if (job.failed) { job.failed = false; job.attempts = 0; job.nextAt = 0; }
    clearTimeout(this.timer); this.timer = undefined; this.changed(); this.schedule();
  }

  reset() {
    this.generation++; this.active?.controller.abort(); this.active = undefined;
    this.pending.clear(); this.submitted.clear(); clearTimeout(this.timer); this.timer = undefined; this.changed();
  }

  private schedule() {
    if (this.active) return;
    clearTimeout(this.timer); this.timer = undefined;
    const times = [...this.pending.values()].filter(job => !job.failed).map(job => job.nextAt);
    if (!times.length) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, Math.max(0, Math.min(...times) - Date.now()));
  }

  private async drain() {
    if (this.active) return;
    const entry = [...this.pending].find(([, job]) => !job.failed && job.nextAt <= Date.now());
    if (!entry) { this.schedule(); return; }
    const [key, job] = entry;
    const { caption } = job;
    const active = { controller: new AbortController(), key };
    this.active = active;
    const generation = this.generation;
    const started = Date.now(); this.changed();
    try {
      if (job.result === undefined) {
        const text = await bounded(signal => this.translate(caption, signal), this.options.timeoutMs ?? 25000, active.controller.signal);
        job.result = finalTranslation(text, caption.incomplete);
      }
      if (generation === this.generation) {
        await bounded(() => Promise.resolve(this.deliver(caption, job.result!)), 3000, active.controller.signal);
        if (generation !== this.generation) return;
        this.pending.delete(key); this.submitted.add(key);
        if (this.submitted.size > 10000) this.submitted.delete(this.submitted.values().next().value!);
        recordDiagnostic('translation', 'sentence_done', { durationMs: Date.now() - started, pending: this.pending.size });
      }
    } catch (error) {
      if (generation === this.generation) {
        const delays = this.options.retryDelays ?? [1000, 3000];
        const delay = delays[job.attempts++];
        job.failed = delay === undefined;
        job.nextAt = Date.now() + (delay ?? 0);
        recordDiagnostic('translation', job.failed ? 'sentence_failed' : 'sentence_retry', {
          errorName: errorName(error), durationMs: Date.now() - started, pending: this.pending.size, attempt: job.attempts });
        this.failure(error);
      }
    } finally {
      if (this.active === active) { this.active = undefined; this.changed(); this.schedule(); }
    }
  }
}
