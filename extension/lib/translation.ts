import { SERVICE, type Caption } from './types';

type TranslatorInstance = { translate(text: string): Promise<string>; destroy(): void };
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
  get ready() { return Boolean(this.instance); }

  async availability(): Promise<string> {
    if (!window.Translator) return 'unsupported';
    return window.Translator.availability({ sourceLanguage: 'en', targetLanguage: 'zh' });
  }

  prepare(onProgress: (value: number) => void): Promise<void> {
    if (this.instance) return Promise.resolve();
    if (this.preparing) return this.preparing;
    if (!window.Translator) return Promise.reject(new Error('这版 Chrome 未提供本地翻译 API。可以先使用英文字幕，或主动选择 DeepSeek。'));
    // Invoked directly from a button, before other awaited network operations.
    this.preparing = window.Translator.create({ sourceLanguage: 'en', targetLanguage: 'zh', signal: AbortSignal.timeout(180000), monitor(monitor) {
      monitor.addEventListener('downloadprogress', event => onProgress((event as Event & { loaded: number }).loaded));
    } }).then(instance => { this.instance = instance; }).finally(() => { this.preparing = undefined; });
    return this.preparing;
  }

  async translate(text: string) {
    if (!this.instance) throw new Error('请先准备本地翻译语言包。');
    return this.instance.translate(text);
  }

  destroy() { this.instance?.destroy(); this.instance = undefined; }
}

export async function serviceTranslate(text: string, token: string, context: string[], provider: 'offline' | 'deepseek'): Promise<string> {
  const response = await fetch(`${SERVICE}/translate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, context, provider }), signal: AbortSignal.timeout(22000),
  });
  if (!response.ok) throw new Error(provider === 'offline' ? '本机离线翻译未就绪或正忙，请运行 setup.ps1 并重启服务。' : response.status === 503 ? '尚未配置 DeepSeek 密钥，请在项目 .env 中填写后重启服务。' : 'DeepSeek 翻译失败，请检查服务、密钥及网络。');
  const result = await response.json();
  return result.text;
}

/** Translate complete, settled sentences exactly once, in reading order. */
export class TranslationQueue {
  private pending = new Map<string, Caption>();
  private generation = 0;
  private running = false;
  private lastRequest = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private submitted = new Set<string>();
  constructor(private translate: (caption: Caption) => Promise<string>,
    private deliver: (caption: Caption, text: string) => void,
    private failure: (error: unknown) => void, private interval = 0) {}

  enqueue(caption: Caption) {
    if (!caption.final || !caption.text.trim() || caption.translation) return;
    const key = `${caption.sessionId}/${caption.id}`;
    if (this.submitted.has(key)) return;
    const previous = this.pending.get(key);
    if (previous && previous.revision >= caption.revision) return;
    if (this.pending.size >= 100 && !previous) {
      const disposable = [...this.pending].find(([, item]) => !item.final);
      if (disposable) this.pending.delete(disposable[0]);
      else { this.failure(new Error('翻译队列积压，请暂停片刻。英文转录仍继续。')); return; }
    }
    this.pending.set(key, caption);
    this.submitted.add(key);
    this.schedule();
  }

  reset() { this.generation++; this.pending.clear(); this.submitted.clear(); clearTimeout(this.timer); this.timer = undefined; }

  private schedule() {
    if (this.running || this.timer || !this.pending.size) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, Math.max(0, this.lastRequest + this.interval - Date.now()));
  }

  private async drain() {
    if (this.running) return;
    const entry = [...this.pending].find(([, caption]) => caption.final) ?? this.pending.entries().next().value;
    if (!entry) return;
    const [key, caption] = entry;
    this.pending.delete(key);
    this.running = true;
    const generation = this.generation;
    this.lastRequest = Date.now();
    try {
      const text = await this.translate(caption);
      if (generation === this.generation) this.deliver(caption, finalTranslation(text, caption.incomplete));
    } catch (error) {
      if (generation === this.generation) { this.pending.clear(); this.submitted.clear(); this.failure(error); }
    } finally { this.running = false; this.schedule(); }
  }
}
