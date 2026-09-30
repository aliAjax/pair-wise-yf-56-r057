'use client';
import { create } from 'zustand';
import { applyOp, initialState, ROLE_LABELS, uid } from './collab/engine';
import { server } from './collab/server';
import type { ActionKind, CollabState, ConflictRecord, Incident, Op, Policy, Role, RolePerms } from './collab/types';

export interface OutboxItem { op: Op; status: 'pending' | 'failed' | 'conflict'; attempts: number; lastError?: string; conflict?: ConflictRecord; }
export interface Receipt { id: string; opId: string; summary: string; status: 'pending' | 'acked' | 'failed' | 'conflict'; at: string; }

interface State {
  incident: Incident;
  policy: Policy;
  role: Role;
  demoMode: boolean;
  online: boolean;
  forceOffline: boolean;
  outbox: OutboxItem[];
  receipts: Receipt[];
  simulateFailure: boolean;
  hydrate: () => void;
  setRole: (role: Role) => void;
  toggleDemo: () => void;
  setForceOffline: (value: boolean) => void;
  setSimulateFailure: (value: boolean) => void;
  addSubIncident: (payload: { title: string; owner: string }) => void;
  editAction: (id: string, patch: { title?: string; kind?: ActionKind; sensitive?: boolean }) => void;
  approveAction: (id: string) => void;
  executeAction: (id: string) => void;
  reorderActions: (activeId: string, overId: string) => void;
  changePerm: (role: Role, perms: Partial<RolePerms>) => void;
  tick: () => void;
  flushOutbox: () => Promise<void>;
  retryOp: (opId: string) => void;
  dismissOp: (opId: string) => void;
  clearReceipt: (id: string) => void;
}

function opSummary(op: Op, incident: Incident): string {
  switch (op.type) {
    case 'addSubIncident': return `新增子事件「${op.title}」`;
    case 'editAction': return `编辑处置动作「${incident.actions.find((a) => a.id === op.entityId)?.title ?? op.entityId}」`;
    case 'approve': return `审批处置动作「${incident.actions.find((a) => a.id === op.entityId)?.title ?? op.entityId}」`;
    case 'execute': return `执行处置动作「${incident.actions.find((a) => a.id === op.entityId)?.title ?? op.entityId}」`;
    case 'reorder': return '调整处置动作优先级';
    case 'policyChange': return `变更${ROLE_LABELS[op.role]}权限`;
    case 'tick': return '监测点同步';
  }
}

let flushing = false;
let hydrated = false;

export const useIncidentStore = create<State>()((set, get) => {
  /** 本地乐观应用 + 入待确认回执 + 触发推送。 */
  function commit(op: Op) {
    const state = get();
    if (state.demoMode) return;
    const { state: next } = applyOp({ incident: state.incident, policy: state.policy, appliedOps: [] }, op);
    const receipt: Receipt = { id: uid('rc'), opId: op.id, summary: opSummary(op, state.incident), status: 'pending', at: op.at };
    set({
      incident: next.incident,
      policy: next.policy,
      outbox: [...state.outbox, { op, status: 'pending', attempts: 0 }],
      receipts: [receipt, ...state.receipts].slice(0, 30)
    });
    void get().flushOutbox();
  }

  async function syncFromServer() {
    const s: CollabState = server.getState();
    set({ incident: s.incident, policy: s.policy });
  }

  return {
    incident: initialState().incident,
    policy: initialState().policy,
    role: 'analyst',
    demoMode: false,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    forceOffline: false,
    outbox: [],
    receipts: [],
    simulateFailure: false,

    hydrate: () => {
      if (hydrated) return;
      hydrated = true;
      void syncFromServer();
      server.subscribe(() => { void syncFromServer(); });
      const onOnline = () => { set({ online: true }); void get().flushOutbox(); };
      const onOffline = () => set({ online: false });
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      set({ online: navigator.onLine });
    },

    setRole: (role) => set({ role }),
    toggleDemo: () => set((s) => ({ demoMode: !s.demoMode })),
    setForceOffline: (forceOffline) => { set({ forceOffline }); if (!forceOffline) void get().flushOutbox(); },
    setSimulateFailure: (simulateFailure) => { set({ simulateFailure }); server.simulateFailure = simulateFailure; },

    addSubIncident: (payload) => commit({
      id: uid('op'), type: 'addSubIncident', at: new Date().toISOString(), by: get().role, baseV: get().incident.v, ...payload
    }),
    editAction: (entityId, patch) => commit({
      id: uid('op'), type: 'editAction', at: new Date().toISOString(), by: get().role, baseV: get().incident.actions.find((a) => a.id === entityId)?.v ?? 1, entityId, patch
    }),
    approveAction: (entityId) => commit({
      id: uid('op'), type: 'approve', at: new Date().toISOString(), by: get().role, baseV: get().incident.v, entityId
    }),
    executeAction: (entityId) => commit({
      id: uid('op'), type: 'execute', at: new Date().toISOString(), by: get().role, baseV: get().incident.v, entityId
    }),
    reorderActions: (activeId, overId) => {
      const state = get();
      if (state.demoMode) return;
      const actions = [...state.incident.actions];
      const from = actions.findIndex((a) => a.id === activeId);
      const to = actions.findIndex((a) => a.id === overId);
      if (from < 0 || to < 0) return;
      const [moved] = actions.splice(from, 1);
      actions.splice(to, 0, moved);
      commit({ id: uid('op'), type: 'reorder', at: new Date().toISOString(), by: state.role, baseV: state.incident.v, order: actions.map((a) => a.id) });
    },
    changePerm: (role, perms) => commit({
      id: uid('op'), type: 'policyChange', at: new Date().toISOString(), by: get().role, baseV: get().policy.v, role, perms
    }),
    tick: () => commit({ id: uid('op'), type: 'tick', at: new Date().toISOString(), by: '系统', baseV: get().incident.v }),

    flushOutbox: async () => {
      if (flushing) return;
      const state = get();
      if (state.forceOffline || !state.online) return;
      const item = state.outbox.find((i) => i.status === 'pending' || i.status === 'failed');
      if (!item) return;
      flushing = true;
      set({ outbox: get().outbox.map((i) => i.op.id === item.op.id ? { ...i, status: 'pending', attempts: i.attempts + 1, lastError: undefined } : i) });
      try {
        const result = await server.applyOp(item.op);
        if (result.ok) {
          set({
            outbox: get().outbox.filter((i) => i.op.id !== item.op.id),
            receipts: get().receipts.map((r) => r.opId === item.op.id ? { ...r, status: 'acked' } : r)
          });
        } else if (result.conflict) {
          set({
            outbox: get().outbox.map((i) => i.op.id === item.op.id ? { ...i, status: 'conflict', conflict: result.conflict } : i),
            receipts: get().receipts.map((r) => r.opId === item.op.id ? { ...r, status: 'conflict' } : r)
          });
        } else {
          set({
            outbox: get().outbox.map((i) => i.op.id === item.op.id ? { ...i, status: 'failed', lastError: result.error } : i),
            receipts: get().receipts.map((r) => r.opId === item.op.id ? { ...r, status: 'failed' } : r)
          });
        }
        await syncFromServer();
      } catch (e) {
        const err = e as Error;
        set({
          outbox: get().outbox.map((i) => i.op.id === item.op.id ? { ...i, status: 'failed', lastError: err.message } : i),
          receipts: get().receipts.map((r) => r.opId === item.op.id ? { ...r, status: 'failed' } : r)
        });
        if (get().online && !get().forceOffline) {
          window.setTimeout(() => { if (get().online && !get().forceOffline) void get().flushOutbox(); }, 4000);
        }
      } finally {
        flushing = false;
        // 仅当队列中没有失败项时继续推送；失败项等待自动重试/手动重试/放弃
        const hasFailed = get().outbox.some((i) => i.status === 'failed');
        if (!hasFailed && get().online && !get().forceOffline) void get().flushOutbox();
      }
    },

    retryOp: (opId) => {
      set({ outbox: get().outbox.map((i) => i.op.id === opId ? { ...i, status: 'pending', lastError: undefined } : i) });
      void get().flushOutbox();
    },
    dismissOp: (opId) => set({ outbox: get().outbox.filter((i) => i.op.id !== opId) }),
    clearReceipt: (id) => set({ receipts: get().receipts.filter((r) => r.id !== id) })
  };
});
