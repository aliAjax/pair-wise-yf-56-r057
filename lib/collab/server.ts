'use client';
import { applyOp, initialState } from './engine';
import type { CollabState, Op, OpResult } from './types';

const STATE_KEY = 'yf56-collab-state-v2';
const CHANNEL = 'yf56-collab-v2';
const LOCK = 'yf56-collab-lock-v2';

type Listener = (state: CollabState) => void;

/**
 * 权威协同端：以 localStorage 为唯一事实来源，跨标签页通过 Web Locks 串行化提交，
 * BroadcastChannel 广播变更。操作按 op.id 幂等，重试不会重复审批/重复执行。
 */
class CollabServer {
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;
  /** 演示用：模拟服务端 500（每个操作仅首次失败，重试即成功）。 */
  simulateFailure = false;
  private failedOnce = new Set<string>();

  constructor() {
    if (typeof window === 'undefined') return;
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = () => this.emit();
    } catch { /* BroadcastChannel 不可用时仅依赖 storage 事件 */ }
    window.addEventListener('storage', (e) => { if (e.key === STATE_KEY) this.emit(); });
  }

  private load(): CollabState {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CollabState;
        if (parsed.incident && parsed.policy && Array.isArray(parsed.appliedOps)) return parsed;
      }
    } catch { /* 损坏则重建 */ }
    const fresh = initialState();
    this.save(fresh);
    return fresh;
  }

  private save(state: CollabState) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  getState(): CollabState {
    return this.load();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit() {
    const state = this.load();
    this.listeners.forEach((l) => l(state));
  }

  private async locked<T>(fn: () => T | Promise<T>): Promise<T> {
    if (typeof navigator === 'undefined') return fn();
    const locks = (navigator as unknown as { locks?: { request: (name: string, fn: () => T | Promise<T>) => Promise<T> } }).locks;
    if (locks) return locks.request(LOCK, fn);
    return fn();
  }

  async applyOp(op: Op): Promise<OpResult> {
    // 模拟网络往返延迟
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 260));
    if (this.simulateFailure && !this.failedOnce.has(op.id)) {
      this.failedOnce.add(op.id);
      const err = new Error('模拟服务端故障：请求未被处理，回执保留中');
      (err as Error & { retryable?: boolean }).retryable = true;
      throw err;
    }
    return this.locked(() => {
      const state = this.load();
      if (state.appliedOps.includes(op.id)) {
        return { ok: true, idempotent: true };
      }
      const { state: next, result } = applyOp(state, op);
      this.save(next);
      try { this.channel?.postMessage({ type: 'op', op }); } catch { /* 广播失败不影响已提交结果 */ }
      return result;
    });
  }
}

export const server = new CollabServer();
