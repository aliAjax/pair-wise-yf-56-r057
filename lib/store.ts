import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  actionNames,
  applyOperation,
  buildLocalView,
  canApproveAction,
  createChannel,
  createId,
  defaultPolicies,
  meetsIsolationRule,
  postSnapshot,
  readRemoteSnapshot,
  roleNames,
  settleOperation,
  type CollabOperation,
  type CollabSnapshot,
  type IncidentStatus,
  type QueuedOperation,
  type ResponseAction,
  type Role,
  type RolePolicyMap,
  type SubIncidentStatus
} from './collab';

interface IncidentState {
  snapshot: CollabSnapshot;
  queue: QueuedOperation[];
  role: Role;
  demoMode: boolean;
  forceOffline: boolean;
  simulateFailureNext: boolean;
  online: boolean;
  hydrated: boolean;
  clientId: string;
  setRole: (role: Role) => void;
  toggleDemo: () => void;
  setForceOffline: (value: boolean) => void;
  setSimulateFailureNext: (value: boolean) => void;
  addSubIncident: (payload: { title: string; owner: string }) => void;
  updateSubIncident: (id: string, payload: { title?: string; owner?: string; status?: SubIncidentStatus }) => void;
  updateIncidentStatus: (status: IncidentStatus) => void;
  addTimelineNote: (payload: { text: string; sensitive: boolean }) => void;
  approveAction: (id: string) => void;
  saveAction: (id: string, expectedRevision: number, payload: { title: string; sensitive: boolean }) => void;
  executeAction: (id: string) => void;
  retryReceipt: (id: string) => void;
  reorderActions: (actionOrder: string[]) => void;
  updatePolicies: (policies: RolePolicyMap, summary: string) => void;
  resolveConflict: (id: string) => void;
  dismissQueueEntry: (id: string) => void;
  settleReceipt: (actionId: string, receiptId: string, attempts: number) => void;
  tick: () => void;
  flushQueue: () => Promise<void>;
}

let channel: BroadcastChannel | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let flushInFlight = false;
let flushQueued = false;

async function withCollabLock<T>(task: () => T | Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('yf56-collab-write', async () => task());
  }
  return task();
}

function scheduleFlush() {
  setTimeout(() => { void useIncidentStore.getState().flushQueue(); }, 0);
}

function browserOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function isExecutableAction(action: ResponseAction, policies: RolePolicyMap) {
  return action.status !== 'executed' && action.status !== 'invalid' && (action.kind !== 'isolate' || meetsIsolationRule(policies, action));
}
const initialClientId = createId('client');

function schedulePendingReceipts(snapshot: CollabSnapshot) {
  const clientId = useIncidentStore.getState().clientId;
  snapshot.incident.actions.forEach((action) => {
    const receipt = action.execution;
    if (action.status !== 'executing' || !receipt || receipt.state !== 'pending_ack') return;
    const timerKey = `${receipt.id}:${receipt.attempts}`;
    if (timers.has(timerKey)) return;
    const ownsReceipt = receipt.ownerClientId === clientId;
    const age = Date.now() - new Date(receipt.at).getTime();
    const delay = ownsReceipt ? 1000 : Math.max(0, 2200 - age);
    const timer = setTimeout(() => {
      timers.delete(timerKey);
      useIncidentStore.getState().settleReceipt(action.id, receipt.id, receipt.attempts);
    }, delay);
    timers.set(timerKey, timer);
  });
}

export const useIncidentStore = create<IncidentState>()(persist((set, get) => {
  function publish(snapshot: CollabSnapshot) {
    set({ snapshot });
    postSnapshot(channel, snapshot, get().clientId);
  }

  async function flushQueue() {
    if (flushInFlight) {
      flushQueued = true;
      return;
    }
    const state = get();
    if (state.demoMode || state.forceOffline || !browserOnline()) return;
    if (state.queue.filter((item) => item.status === 'queued').length === 0) return;
    flushInFlight = true;
    try {
      await withCollabLock(() => {
        const currentState = get();
        let current = readRemoteSnapshot();
        const remaining: QueuedOperation[] = [];
        const localActionRevisions = new Map<string, number>();
        for (const item of currentState.queue) {
          if (item.status !== 'queued') {
            remaining.push(item);
            continue;
          }
          let op = item.op;
          if (op.type === 'edit-action') {
            op = { ...op, expectedRevision: op.expectedRevision - (localActionRevisions.get(op.actionId) ?? 0) };
          }
          const result = applyOperation(current, op);
          if (result.code === 'revision_conflict' && result.conflict && item.op.type === 'edit-action') {
            result.conflict.expectedRevision = item.op.expectedRevision;
          }
          current = result.snapshot;
          if ((op.type === 'edit-action' || op.type === 'approve-action') && result.accepted) {
            localActionRevisions.set(op.actionId, (localActionRevisions.get(op.actionId) ?? 0) + 1);
          }
          if (result.accepted) continue;
          if (result.code === 'operation_already_applied') continue;
          remaining.push({
            ...item,
            status: result.code === 'revision_conflict' ? 'conflicted' : 'rejected',
            processedAt: new Date().toISOString(),
            code: result.code,
            conflictId: result.conflict?.id
          });
        }
        publish(current);
        set({ queue: remaining });
        schedulePendingReceipts(current);
      });
    } finally {
      flushInFlight = false;
      if (flushQueued) {
        flushQueued = false;
        await flushQueue();
      }
    }
  }

  async function commitOrQueue(op: CollabOperation) {
    const state = get();
    if (state.demoMode) return;
    const online = browserOnline() && !state.forceOffline;
    if (!online) {
      set((value) => ({ queue: [...value.queue, { op, status: 'queued', queuedAt: new Date().toISOString() }] }));
      return;
    }

    if (state.queue.some((item) => item.status === 'queued')) {
      set((value) => ({ queue: [...value.queue, { op, status: 'queued', queuedAt: new Date().toISOString() }] }));
      await flushQueue();
      return;
    }

    await withCollabLock(() => {
      const remote = readRemoteSnapshot();
      const result = applyOperation(remote, op);
      if (result.accepted || result.code === 'revision_conflict' || result.code === 'operation_already_applied') {
        publish(result.snapshot);
        if (result.executionRequested) schedulePendingReceipts(result.snapshot);
      }
    });
  }

  function makeOperation<T extends Omit<CollabOperation, 'id' | 'clientId' | 'at' | 'actorRole' | 'actorName'>>(partial: T, consumeFailure = false) {
    const state = get();
    const simulateFailure = consumeFailure && state.simulateFailureNext;
    if (consumeFailure) set({ simulateFailureNext: false });
    return {
      ...partial,
      id: createId('op'),
      clientId: state.clientId,
      at: new Date().toISOString(),
      actorRole: state.role,
      actorName: roleNames[state.role],
      ...(simulateFailure ? { simulateFailure: true } : {})
    } as CollabOperation;
  }

  return {
    snapshot: readRemoteSnapshot(),
    queue: [],
    role: 'analyst',
    demoMode: false,
    forceOffline: false,
    simulateFailureNext: false,
    online: browserOnline(),
    hydrated: false,
    clientId: initialClientId,

    setRole: (role) => set({ role }),
    toggleDemo: () => set((state) => ({ demoMode: !state.demoMode })),
    setForceOffline: (value) => {
      set({ forceOffline: value, online: browserOnline() && !value });
      if (!value) scheduleFlush();
    },
    setSimulateFailureNext: (value) => set({ simulateFailureNext: value }),

    addSubIncident: ({ title, owner }) => {
      if (get().demoMode) return;
      commitOrQueue(makeOperation({ type: 'add-sub-incident', subId: createId('sub'), title, owner }));
    },

    updateSubIncident: (id, payload) => {
      if (get().demoMode) return;
      commitOrQueue(makeOperation({ type: 'update-sub-incident', subId: id, ...payload }));
    },

    updateIncidentStatus: (status) => {
      if (get().demoMode) return;
      commitOrQueue(makeOperation({ type: 'update-incident', status }));
    },

    addTimelineNote: ({ text, sensitive }) => {
      if (get().demoMode) return;
      commitOrQueue(makeOperation({ type: 'add-timeline', text, sensitive }));
    },

    approveAction: (id) => {
      const state = get();
      if (state.demoMode || state.role === 'viewer') return;
      const view = buildLocalView(state.snapshot, state.queue).snapshot;
      const action = view.incident.actions.find((item) => item.id === id);
      if (!action || action.approvals.some((approval) => approval.role === state.role) || !canApproveAction(view.rolePolicies, state.role, action)) return;
      commitOrQueue(makeOperation({ type: 'approve-action', actionId: id }));
    },

    saveAction: (id, expectedRevision, payload) => {
      if (get().demoMode) return;
      commitOrQueue(makeOperation({ type: 'edit-action', actionId: id, expectedRevision, ...payload }));
    },

    executeAction: (id) => {
      const state = get();
      if (state.demoMode || state.role === 'viewer') return;
      const view = buildLocalView(state.snapshot, state.queue).snapshot;
      const action = view.incident.actions.find((item) => item.id === id);
      if (!action || !isExecutableAction(action, view.rolePolicies) || action.execution?.state === 'pending_ack') return;
      commitOrQueue(makeOperation({ type: 'execute-request', actionId: id, receiptId: createId('receipt') }, true));
    },

    retryReceipt: (id) => {
      const state = get();
      if (state.demoMode || state.role === 'viewer') return;
      const action = state.snapshot.incident.actions.find((item) => item.id === id);
      if (!action?.execution || action.execution.state !== 'failed') return;
      commitOrQueue(makeOperation({
        type: 'execute-confirm',
        actionId: id,
        receiptId: action.execution.id,
        attempts: action.execution.attempts
      }, true));
    },

    reorderActions: (actionOrder) => {
      if (get().demoMode) return;
      commitOrQueue(makeOperation({ type: 'reorder-actions', actionOrder }));
    },

    updatePolicies: (policies, summary) => {
      if (get().demoMode) return;
      commitOrQueue(makeOperation({ type: 'update-policy', policies: structuredClone(policies), summary }));
    },

    resolveConflict: (id) => {
      void withCollabLock(() => {
        const remote = readRemoteSnapshot();
        const snapshot = structuredClone(remote);
        snapshot.conflicts = snapshot.conflicts.map((conflict) => conflict.id === id ? { ...conflict, resolved: true } : conflict);
        publish(snapshot);
      });
    },

    dismissQueueEntry: (id) => {
      set((state) => ({ queue: state.queue.filter((item) => item.op.id !== id || item.status === 'queued') }));
    },

    settleReceipt: (actionId, receiptId, attempts) => {
      const state = get();
      if (state.demoMode) return;
      const action = state.snapshot.incident.actions.find((item) => item.id === actionId);
      const receipt = action?.execution;
      if (!action || !receipt || receipt.id !== receiptId || receipt.attempts !== attempts || receipt.state !== 'pending_ack') return;
      commitOrQueue(settleOperation(receipt, actionId, state.clientId, receipt.willFail === true));
    },

    tick: () => {
      if (get().demoMode) return;
      commitOrQueue(makeOperation({ type: 'tick' }));
    },

    flushQueue
  };
}, {
  name: 'yf56-incident-collab-v1',
  partialize: (state) => ({
    queue: state.queue,
    role: state.role,
    demoMode: state.demoMode,
    forceOffline: state.forceOffline,
    simulateFailureNext: state.simulateFailureNext,
    clientId: state.clientId
  }),
  storage: createJSONStorage(() => typeof window === 'undefined' ? {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  } : window.sessionStorage),
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    const clientId = state.clientId || createId('client');
    channel = createChannel();
    const remote = readRemoteSnapshot();
    state.clientId = clientId;
    state.snapshot = remote;
    state.online = browserOnline() && !state.forceOffline;
    state.hydrated = true;

    channel?.addEventListener('message', (event: MessageEvent<{ clientId?: string; snapshot?: CollabSnapshot }>) => {
      if (!event.data?.snapshot || event.data.clientId === useIncidentStore.getState().clientId) return;
      useIncidentStore.setState({ snapshot: event.data.snapshot });
      void useIncidentStore.getState().flushQueue();
      schedulePendingReceipts(event.data.snapshot);
    });

    window.addEventListener('storage', (event) => {
      if (event.key !== 'yf56-collab-server-v1' || !event.newValue) return;
      try {
        const snapshot = JSON.parse(event.newValue) as CollabSnapshot;
        useIncidentStore.setState({ snapshot });
        void useIncidentStore.getState().flushQueue();
        schedulePendingReceipts(snapshot);
      } catch {
        // 保留当前快照，等待下一条有效协同消息
      }
    });

    const updateOnline = () => {
      const online = browserOnline() && !useIncidentStore.getState().forceOffline;
      useIncidentStore.setState({ online });
      if (online) useIncidentStore.getState().flushQueue();
    };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    if (state.online) void state.flushQueue();
    setTimeout(() => schedulePendingReceipts(useIncidentStore.getState().snapshot), 0);
  }
}));

export function canEditPolicies(role: Role) {
  return role !== 'viewer';
}

export { actionNames, defaultPolicies, roleNames };
