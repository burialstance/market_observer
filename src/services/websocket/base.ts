import type { Exchange, MarketType } from '../../types';

/** Статусы WebSocket-соединения */
export type WsStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface ConnState {
  exchange: Exchange;
  market: MarketType;
  status: WsStatus;
}

export interface WsClientOptions {
  /** Дебаунс отправки подписок (мс) — для оптимизации при частых изменениях */
  subscribeDebounceMs?: number;
}

/**
 * Базовый WebSocket-клиент с:
 *  - мультиплексированием стримов в одном соединении;
 *  - автоматическим переподключением с экспоненциальной задержкой;
 *  - heartbeat (Ping) механизмом;
 *  - дебаунсом/троттлингом операций (un)subscribe.
 */
export abstract class BaseWsClient {
  protected ws: WebSocket | null = null;
  protected url: string;
  protected readonly exchange: Exchange;
  protected readonly market: MarketType;
  protected subscribed = new Set<string>();
  protected pendingSub = new Set<string>();
  protected pendingUnsub = new Set<string>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private debouncedFlush: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private intentionalClose = false;
  private lastMessageAt = Date.now();

  onMessage: (data: unknown) => void = () => {};
  onStatusChange: (status: WsStatus) => void = () => {};

  constructor(url: string, exchange: Exchange, market: MarketType, opts?: WsClientOptions) {
    this.url = url;
    this.exchange = exchange;
    this.market = market;
    this.debounceMs = opts?.subscribeDebounceMs ?? 150;
  }

  get status(): WsStatus {
    if (!this.ws) return 'closed';
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'open';
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
        return 'closed';
      default:
        return 'closed';
    }
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.intentionalClose = false;
    this.setStatus('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.setStatus('error');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.setStatus('open');
      // Переподписка после реконнекта
      const streams = [...this.subscribed];
      this.subscribed.clear();
      for (const s of streams) this.subscribe(s);
      this.flushPending();
      this.startHeartbeat();
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      this.lastMessageAt = Date.now();
      if (typeof ev.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handleParsed(parsed);
    };

    this.ws.onerror = () => {
      this.setStatus('error');
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.setStatus('closed');
      if (!this.intentionalClose) this.scheduleReconnect();
    };
  }

  /** Вызывается из onmessage после JSON.parse */
  protected abstract handleParsed(parsed: unknown): void;

  /** Отправить подписку на стрим (реализация зависит от биржи) */
  protected abstract sendSubscribe(stream: string): void;
  protected abstract sendUnsubscribe(stream: string): void;
  /** Построить URL соединения (например, combined-streams) */
  protected abstract buildUrl(streams: string[]): string;

  protected setStatus(status: WsStatus): void {
    this.onStatusChange(status);
  }

  subscribe(stream: string): void {
    if (this.subscribed.has(stream)) return;
    this.pendingSub.add(stream);
    this.pendingUnsub.delete(stream);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.debouncedSend();
    } else {
      // Сохраняем для подписки после установления соединения
      this.subscribed.add(stream);
      this.pendingSub.delete(stream);
      this.connect();
    }
  }

  unsubscribe(stream: string): void {
    if (!this.subscribed.has(stream) && !this.pendingSub.has(stream)) return;
    this.subscribed.delete(stream);
    this.pendingSub.delete(stream);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.pendingUnsub.add(stream);
      this.debouncedSend();
    }
  }

  setSubscriptions(streams: string[]): void {
    const next = new Set(streams);
    for (const s of next) this.subscribe(s);
    for (const s of [...this.subscribed]) {
      if (!next.has(s)) this.unsubscribe(s);
    }
  }

  private debouncedSend(): void {
    if (this.debouncedFlush) return;
    this.debouncedFlush = setTimeout(() => {
      this.debouncedFlush = null;
      this.flushPending();
    }, this.debounceMs);
  }

  protected flushPending(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    for (const s of this.pendingSub) {
      this.sendSubscribe(s);
      this.subscribed.add(s);
    }
    for (const s of this.pendingUnsub) {
      this.sendUnsubscribe(s);
    }
    this.pendingSub.clear();
    this.pendingUnsub.clear();
  }

  protected sendRaw(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  /** Обновить URL и переподключиться (используется до первого connect) */
  protected updateUrl(url: string): void {
    this.url = url;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.onHeartbeatTick();
        // Если долго нет сообщений — принудительный реконнект
        if (Date.now() - this.lastMessageAt > 120_000) {
          this.forceReconnect();
        }
      }
    }, 20_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Хук heartbeat: Binance отвечает серверным pong, Bybit требует client ping */
  protected onHeartbeatTick(): void {}

  protected forceReconnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalClose) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Пересобрать URL с учётом текущих подписок
      this.updateUrl(this.buildUrl([...this.subscribed]));
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
    this.setStatus('closed');
  }
}
