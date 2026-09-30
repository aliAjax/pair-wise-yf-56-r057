export type Role = 'analyst' | 'responder' | 'legal' | 'viewer';
export type Severity = 'medium' | 'high' | 'critical';
export type ActionKind = 'isolate' | 'block' | 'restore' | 'notify';
export type ActionStatus = 'pending' | 'approved' | 'executing' | 'executed' | 'failed' | 'invalid';
export type IncidentStatus = 'investigating' | 'contained' | 'recovered';
export type SubIncidentStatus = 'open' | 'contained' | 'closed';
export type ApprovalState = 'valid' | 'invalid';

export interface TimelineEvent {
  id: string;
  at: string;
  actor: string;
  text: string;
  sensitive?: boolean;
  pending?: boolean;
}

export interface SubIncident {
  id: string;
  title: string;
  owner: string;
  status: SubIncidentStatus;
  revision: number;
  updatedAt: string;
}

export interface ApprovalRecord {
  role: Exclude<Role, 'viewer'>;
  at: string;
}

export interface ExecutionReceipt {
  id: string;
  requestOpId: string;
  ownerClientId: string;
  actorRole: Role;
  at: string;
  attempts: number;
  state: 'pending_ack' | 'failed' | 'succeeded';
  lastError?: string;
  willFail?: boolean;
}

export interface ResponseAction {
  id: string;
  title: string;
  kind: ActionKind;
  sensitive?: boolean;
  approvals: ApprovalRecord[];
  status: ActionStatus;
  revision: number;
  updatedAt: string;
  execution?: ExecutionReceipt;
}

export interface RolePolicy {
  label: string;
  canApproveKinds: ActionKind[];
  sensitiveClearance: boolean;
}

export type RolePolicyMap = Record<Exclude<Role, 'viewer'>, RolePolicy>;

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  revision: number;
  affected: string[];
  subIncidents: SubIncident[];
  actions: ResponseAction[];
  actionOrder: string[];
  timeline: TimelineEvent[];
  processedOperationIds: string[];
}

export interface ConflictPatch {
  title: string;
  sensitive: boolean;
}

export interface ConflictRecord {
  id: string;
  opId: string;
  actionId: string;
  actionTitle: string;
  actor: string;
  expectedRevision: number;
  actualRevision: number;
  incoming: ConflictPatch;
  remote: ConflictPatch;
  at: string;
  resolved: boolean;
}

export interface CollabSnapshot {
  version: 1;
  incident: Incident;
  rolePolicies: RolePolicyMap;
  conflicts: ConflictRecord[];
  lastMutationAt: string;
}

interface BaseOp {
  id: string;
  clientId: string;
  at: string;
  actorRole: Role;
  actorName: string;
  simulateFailure?: boolean;
}

export type CollabOperation =
  | (BaseOp & { type: 'add-sub-incident'; subId: string; title: string; owner: string })
  | (BaseOp & { type: 'update-sub-incident'; subId: string; title?: string; owner?: string; status?: SubIncidentStatus })
  | (BaseOp & { type: 'update-incident'; status: IncidentStatus })
  | (BaseOp & { type: 'add-timeline'; text: string; sensitive?: boolean })
  | (BaseOp & { type: 'tick' })
  | (BaseOp & { type: 'reorder-actions'; actionOrder: string[] })
  | (BaseOp & { type: 'approve-action'; actionId: string })
  | (BaseOp & { type: 'edit-action'; actionId: string; expectedRevision: number; title: string; sensitive: boolean })
  | (BaseOp & { type: 'execute-request'; actionId: string; receiptId: string })
  | (BaseOp & { type: 'execute-confirm'; actionId: string; receiptId: string; attempts: number })
  | (BaseOp & { type: 'execute-result'; actionId: string; receiptId: string; attempts: number; outcome: 'success' | 'failure'; error?: string })
  | (BaseOp & { type: 'update-policy'; policies: RolePolicyMap; summary: string });

export type QueueStatus = 'queued' | 'conflicted' | 'rejected';

export interface QueuedOperation {
  op: CollabOperation;
  status: QueueStatus;
  queuedAt: string;
  processedAt?: string;
  code?: string;
  conflictId?: string;
}

export interface ApplyResult {
  accepted: boolean;
  code?: string;
  conflict?: ConflictRecord;
  snapshot: CollabSnapshot;
  executionRequested?: boolean;
}

export const roleNames: Record<Role, string> = {
  analyst: '分析员',
  responder: '响应负责人',
  legal: '法务/公关',
  viewer: '访客'
};

export const actionNames: Record<ActionKind, string> = {
  isolate: '隔离',
  block: '封禁',
  restore: '恢复',
  notify: '通知'
};

export const statusNames: Record<ActionStatus, string> = {
  pending: '待审批',
  approved: '已批准',
  executing: '执行中',
  executed: '已执行',
  failed: '执行失败',
  invalid: '已失效'
};

export const defaultPolicies: RolePolicyMap = {
  analyst: { label: '分析员', canApproveKinds: ['block', 'isolate', 'restore'], sensitiveClearance: false },
  responder: { label: '响应负责人', canApproveKinds: ['isolate', 'block', 'restore', 'notify'], sensitiveClearance: true },
  legal: { label: '法务/公关', canApproveKinds: ['notify', 'isolate'], sensitiveClearance: true }
};

export function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function now(): string {
  return new Date().toISOString();
}

function event(id: string, actor: string, text: string, sensitive = false, at = now(), pending = false): TimelineEvent {
  return { id, at, actor, text, ...(sensitive ? { sensitive } : {}), ...(pending ? { pending } : {}) };
}

export function createInitialSnapshot(): CollabSnapshot {
  const at = now();
  const incident: Incident = {
    id: 'INC-2026-0929',
    title: '对外网关异常凭证使用',
    severity: 'critical',
    status: 'investigating',
    revision: 1,
    affected: ['api-gateway', 'customer-portal', 'audit-log'],
    subIncidents: [
      { id: 'sub-1', title: '异常会话来源分析', owner: '分析组', status: 'open', revision: 1, updatedAt: at },
      { id: 'sub-2', title: '受影响租户范围确认', owner: '平台组', status: 'open', revision: 1, updatedAt: at }
    ],
    actions: [
      { id: 'act-1', title: '隔离异常网关节点', kind: 'isolate', sensitive: true, approvals: [], status: 'pending', revision: 1, updatedAt: at },
      { id: 'act-2', title: '封禁可疑出口地址', kind: 'block', approvals: [], status: 'pending', revision: 1, updatedAt: at },
      { id: 'act-3', title: '准备客户披露口径', kind: 'notify', sensitive: true, approvals: [{ role: 'legal', at }], status: 'pending', revision: 1, updatedAt: at }
    ],
    actionOrder: ['act-1', 'act-2', 'act-3'],
    timeline: [
      event('e-seed-1', '告警平台', '检测到同一凭证跨三个地域登录', true, new Date(Date.now() - 1500000).toISOString()),
      event('e-seed-2', '值班分析员', '确认会话未经过常规办公出口', false, new Date(Date.now() - 900000).toISOString())
    ],
    processedOperationIds: []
  };
  return { version: 1, incident, rolePolicies: structuredClone(defaultPolicies), conflicts: [], lastMutationAt: at };
}

export function canViewSensitive(policies: RolePolicyMap, role: Role): boolean {
  return role !== 'viewer' && policies[role]?.sensitiveClearance === true;
}

export function canApproveAction(policies: RolePolicyMap, role: Role, action: ResponseAction): boolean {
  if (role === 'viewer') return false;
  const policy = policies[role];
  if (!policy || !policy.canApproveKinds.includes(action.kind)) return false;
  return !action.sensitive || policy.sensitiveClearance;
}

export function isApprovalValid(policies: RolePolicyMap, action: ResponseAction, approval: ApprovalRecord): boolean {
  return canApproveAction(policies, approval.role, action);
}

export function validApprovals(policies: RolePolicyMap, action: ResponseAction): ApprovalRecord[] {
  return action.approvals.filter((approval) => isApprovalValid(policies, action, approval));
}

export function meetsIsolationRule(policies: RolePolicyMap, action: ResponseAction): boolean {
  if (action.kind !== 'isolate') return true;
  return new Set(validApprovals(policies, action).map((approval) => approval.role)).size >= 2;
}

function addTimeline(snapshot: CollabSnapshot, eventValue: TimelineEvent) {
  snapshot.incident.timeline = [eventValue, ...snapshot.incident.timeline].slice(0, 200);
}

function recomputeIsolation(snapshot: CollabSnapshot, action: ResponseAction, reason: string | undefined, eventId: string): boolean {
  if (action.kind !== 'isolate' || !['pending', 'approved', 'executing'].includes(action.status)) return false;
  if (meetsIsolationRule(snapshot.rolePolicies, action)) {
    if (action.status === 'pending' || action.status === 'approved') action.status = 'approved';
    return false;
  }
  action.status = 'invalid';
  if (action.execution?.state === 'pending_ack') {
    action.execution.state = 'failed';
    action.execution.lastError = '权限或敏感级别变化，执行条件不再满足';
  }
  if (reason) {
    addTimeline(snapshot, event(eventId, '协同规则', `${reason}，待执行动作已失效：${action.title}`, action.sensitive));
  }
  return true;
}

function reject(snapshot: CollabSnapshot, code: string): ApplyResult {
  return { accepted: false, code, snapshot };
}

export function applyOperation(input: CollabSnapshot, operation: CollabOperation): ApplyResult {
  const snapshot: CollabSnapshot = structuredClone(input);
  if (snapshot.incident.processedOperationIds.includes(operation.id)) {
    return { accepted: false, code: 'operation_already_applied', snapshot: input };
  }
  snapshot.lastMutationAt = operation.at;
  const incident = snapshot.incident;
  const actor = operation.actorName || roleNames[operation.actorRole];

  const accept = (executionRequested = false): ApplyResult => {
    snapshot.incident.processedOperationIds = [operation.id, ...snapshot.incident.processedOperationIds].slice(0, 500);
    return { accepted: true, snapshot, ...(executionRequested ? { executionRequested: true } : {}) };
  };

  switch (operation.type) {
    case 'add-sub-incident': {
      const sub: SubIncident = {
        id: operation.subId,
        title: operation.title,
        owner: operation.owner,
        status: 'open',
        revision: 1,
        updatedAt: operation.at
      };
      incident.subIncidents.push(sub);
      addTimeline(snapshot, event(`e-${operation.id}`, actor, `创建子事件：${operation.title}`, false, operation.at));
      return accept();
    }
    case 'update-sub-incident': {
      const sub = incident.subIncidents.find((item) => item.id === operation.subId);
      if (!sub) return reject(snapshot, 'sub_incident_not_found');
      let changed = false;
      if (operation.title !== undefined && operation.title !== sub.title) { sub.title = operation.title; changed = true; }
      if (operation.owner !== undefined && operation.owner !== sub.owner) { sub.owner = operation.owner; changed = true; }
      if (operation.status && operation.status !== sub.status) { sub.status = operation.status; changed = true; }
      if (!changed) return reject(snapshot, 'no_change');
      sub.revision += 1;
      sub.updatedAt = operation.at;
      addTimeline(snapshot, event(`e-${operation.id}`, actor, `更新子事件：${sub.title}（${sub.status}）`, false, operation.at));
      return accept();
    }
    case 'update-incident': {
      if (incident.status === operation.status) return reject(snapshot, 'no_change');
      incident.status = operation.status;
      incident.revision += 1;
      addTimeline(snapshot, event(`e-${operation.id}`, actor, `主事件阶段更新为：${operation.status}`, false, operation.at));
      return accept();
    }
    case 'add-timeline': {
      if (!operation.text.trim()) return reject(snapshot, 'empty_timeline');
      addTimeline(snapshot, event(`e-${operation.id}`, actor, operation.text, operation.sensitive === true, operation.at));
      return accept();
    }
    case 'tick': {
      addTimeline(snapshot, event(`e-${operation.id}`, '监测代理', `实时检查：${incident.affected.length} 项资产状态已更新`, false, operation.at));
      return accept();
    }
    case 'reorder-actions': {
      const known = new Set(incident.actions.map((action) => action.id));
      const incoming = operation.actionOrder.filter((id) => known.has(id));
      const missing = incident.actions.map((action) => action.id).filter((id) => !incoming.includes(id));
      incident.actionOrder = [...new Set([...incoming, ...missing])];
      return accept();
    }
    case 'approve-action': {
      const action = incident.actions.find((item) => item.id === operation.actionId);
      if (!action) return reject(snapshot, 'action_not_found');
      if (action.status === 'executed') return reject(snapshot, 'already_executed');
      if (action.status === 'invalid') return reject(snapshot, 'action_invalid');
      if (action.status === 'executing') return reject(snapshot, 'execution_inflight');
      if (operation.actorRole === 'viewer') return reject(snapshot, 'role_not_permitted');
      if (!canApproveAction(snapshot.rolePolicies, operation.actorRole, action)) return reject(snapshot, 'role_not_permitted');
      if (action.approvals.some((approval) => approval.role === operation.actorRole)) return reject(snapshot, 'already_approved');
      action.approvals.push({ role: operation.actorRole, at: operation.at });
      action.revision += 1;
      action.updatedAt = operation.at;
      if (action.kind === 'isolate' && meetsIsolationRule(snapshot.rolePolicies, action)) action.status = 'approved';
      addTimeline(snapshot, event(`e-${operation.id}`, actor, `审批处置动作：${action.title}`, action.sensitive === true, operation.at));
      return accept();
    }
    case 'edit-action': {
      const action = incident.actions.find((item) => item.id === operation.actionId);
      if (!action) return reject(snapshot, 'action_not_found');
      if (action.status === 'executed') return reject(snapshot, 'already_executed');
      if (action.status === 'executing') return reject(snapshot, 'execution_inflight');
      if (action.revision !== operation.expectedRevision) {
        const existingConflict = snapshot.conflicts.find((item) => item.opId === operation.id);
        if (existingConflict) return reject(snapshot, 'revision_conflict');
        const conflict: ConflictRecord = {
          id: `conflict-${operation.id}`,
          opId: operation.id,
          actionId: action.id,
          actionTitle: action.title,
          actor,
          expectedRevision: operation.expectedRevision,
          actualRevision: action.revision,
          incoming: { title: operation.title, sensitive: operation.sensitive },
          remote: { title: action.title, sensitive: action.sensitive === true },
          at: operation.at,
          resolved: false
        };
        snapshot.conflicts = [conflict, ...snapshot.conflicts].slice(0, 100);
        addTimeline(snapshot, event(`e-conflict-${operation.id}`, actor, `检测到处置动作版本冲突，已保留两版：${action.title}`, false, operation.at));
        return { accepted: false, code: 'revision_conflict', conflict, snapshot };
      }
      let changed = false;
      if (action.title !== operation.title) { action.title = operation.title; changed = true; }
      const sensitivityChanged = action.sensitive !== operation.sensitive;
      if (sensitivityChanged) { action.sensitive = operation.sensitive; changed = true; }
      if (!changed) return reject(snapshot, 'no_change');
      action.revision += 1;
      action.updatedAt = operation.at;
      if (sensitivityChanged) recomputeIsolation(snapshot, action, '敏感级别变化', `e-invalid-${operation.id}-${action.id}`);
      addTimeline(snapshot, event(`e-${operation.id}`, actor, `修改处置动作：${action.title}`, action.sensitive === true, operation.at));
      return accept();
    }
    case 'execute-request': {
      const action = incident.actions.find((item) => item.id === operation.actionId);
      if (!action) return reject(snapshot, 'action_not_found');
      if (action.status === 'executed') return reject(snapshot, 'already_executed');
      if (action.status === 'invalid') return reject(snapshot, 'action_invalid');
      if (action.status === 'failed') return reject(snapshot, 'use_retry_receipt');
      if (action.execution?.state === 'pending_ack') return reject(snapshot, 'receipt_pending_ack');
      if (action.kind === 'isolate' && !meetsIsolationRule(snapshot.rolePolicies, action)) return reject(snapshot, 'insufficient_valid_approvals');
      const receipt: ExecutionReceipt = {
        id: operation.receiptId,
        requestOpId: operation.id,
        ownerClientId: operation.clientId,
        actorRole: operation.actorRole,
        at: operation.at,
        attempts: 1,
        state: 'pending_ack',
        ...(operation.simulateFailure ? { willFail: true } : {})
      };
      action.status = 'executing';
      action.execution = receipt;
      action.updatedAt = operation.at;
      addTimeline(snapshot, event(`e-${operation.id}`, actor, `发起执行并等待回执：${action.title}`, action.sensitive === true, operation.at));
      return accept(true);
    }
    case 'execute-confirm': {
      const action = incident.actions.find((item) => item.id === operation.actionId);
      if (!action) return reject(snapshot, 'action_not_found');
      if (action.status === 'executed' || action.execution?.state === 'succeeded') return reject(snapshot, 'already_executed');
      if (action.status === 'invalid') return reject(snapshot, 'action_invalid');
      if (action.kind === 'isolate' && !meetsIsolationRule(snapshot.rolePolicies, action)) return reject(snapshot, 'insufficient_valid_approvals');
      if (!action.execution) return reject(snapshot, 'receipt_not_found');
      const attempts = action.execution.state === 'failed' ? action.execution.attempts + 1 : operation.attempts;
      action.execution.attempts = attempts;
      action.execution.state = 'pending_ack';
      action.execution.at = operation.at;
      action.execution.lastError = undefined;
      action.execution.willFail = operation.simulateFailure ? true : undefined;
      action.status = 'executing';
      addTimeline(snapshot, event(`e-${operation.id}`, actor, `第 ${attempts} 次请求执行回执：${action.title}`, action.sensitive === true, operation.at));
      return accept(true);
    }
    case 'execute-result': {
      const action = incident.actions.find((item) => item.id === operation.actionId);
      if (!action) return reject(snapshot, 'action_not_found');
      if (action.status === 'executed' || action.execution?.state === 'succeeded') return reject(snapshot, 'already_executed');
      if (action.status === 'invalid') return reject(snapshot, 'action_invalid');
      if (action.kind === 'isolate' && !meetsIsolationRule(snapshot.rolePolicies, action)) return reject(snapshot, 'insufficient_valid_approvals');
      if (!action.execution || action.execution.id !== operation.receiptId) return reject(snapshot, 'receipt_not_found');
      if (operation.attempts !== action.execution.attempts) return reject(snapshot, 'stale_receipt_attempt');
      if (operation.outcome === 'success') {
        action.status = 'executed';
        action.execution.state = 'succeeded';
        action.execution.lastError = undefined;
        action.execution.willFail = undefined;
        addTimeline(snapshot, event(`e-${operation.id}`, actor, `执行完成：${action.title}（第 ${operation.attempts} 次尝试）`, action.sensitive === true, operation.at));
      } else {
        action.status = 'failed';
        action.execution.state = 'failed';
        action.execution.lastError = operation.error || '执行器返回失败，回执已保留';
        action.execution.willFail = undefined;
        addTimeline(snapshot, event(`e-${operation.id}`, actor, `执行失败并保留待确认回执：${action.title}`, action.sensitive === true, operation.at));
      }
      return accept();
    }
    case 'update-policy': {
      snapshot.rolePolicies = structuredClone(operation.policies);
      addTimeline(snapshot, event(`e-${operation.id}`, actor, `角色权限或敏感级别策略已更新：${operation.summary}`, false, operation.at));
      incident.actions.forEach((action) => recomputeIsolation(snapshot, action, '角色权限变化', `e-invalid-${operation.id}-${action.id}`));
      return accept();
    }
  }
}

export function settleOperation(receipt: ExecutionReceipt, actionId: string, clientId: string, simulateFailure: boolean): CollabOperation {
  return {
    id: `result-${receipt.id}-${receipt.attempts}`,
    clientId,
    at: now(),
    actorRole: receipt.actorRole,
    actorName: roleNames[receipt.actorRole],
    type: 'execute-result',
    actionId,
    receiptId: receipt.id,
    attempts: receipt.attempts,
    outcome: simulateFailure ? 'failure' : 'success',
    ...(simulateFailure ? { error: '模拟执行器确认失败，可凭回执重试' } : {})
  };
}

type PendingSets = {
  timeline: Set<string>;
  actions: Set<string>;
  subs: Set<string>;
};

function applyLocalOp(snapshot: CollabSnapshot, queued: QueuedOperation, pending: PendingSets): CollabSnapshot {
  const op = queued.op;
  const next = structuredClone(snapshot);
  next.lastMutationAt = op.at;
  const actor = op.actorName;
  const localEvent = (text: string, sensitive = false, at = op.at): TimelineEvent => {
    const timelineEvent = event(`e-${op.id}`, actor, text, sensitive, at, true);
    pending.timeline.add(timelineEvent.id);
    return timelineEvent;
  };

  switch (op.type) {
    case 'add-sub-incident': {
      next.incident.subIncidents.push({ id: op.subId, title: op.title, owner: op.owner, status: 'open', revision: 1, updatedAt: op.at });
      pending.subs.add(op.subId);
      addTimeline(next, localEvent(`创建子事件：${op.title}`));
      break;
    }
    case 'update-sub-incident': {
      const sub = next.incident.subIncidents.find((item) => item.id === op.subId);
      if (sub) {
        if (op.title !== undefined) sub.title = op.title;
        if (op.owner !== undefined) sub.owner = op.owner;
        if (op.status) sub.status = op.status;
        sub.revision += 1;
        sub.updatedAt = op.at;
        pending.subs.add(sub.id);
      }
      addTimeline(next, localEvent(`更新子事件：${sub?.title ?? op.subId}（待同步）`));
      break;
    }
    case 'update-incident': {
      next.incident.status = op.status;
      next.incident.revision += 1;
      addTimeline(next, localEvent(`主事件阶段更新为：${op.status}`));
      break;
    }
    case 'add-timeline':
      addTimeline(next, localEvent(op.text, op.sensitive === true));
      break;
    case 'tick':
      addTimeline(next, localEvent(`实时检查：${next.incident.affected.length} 项资产状态已更新（待同步）`));
      break;
    case 'reorder-actions': {
      const known = new Set(next.incident.actions.map((action) => action.id));
      next.incident.actionOrder = [...new Set([...op.actionOrder.filter((id) => known.has(id)), ...next.incident.actionOrder])];
      break;
    }
    case 'approve-action': {
      const action = next.incident.actions.find((item) => item.id === op.actionId);
      if (action && action.status !== 'executed' && action.status !== 'invalid' && !action.approvals.some((item) => item.role === op.actorRole) && canApproveAction(next.rolePolicies, op.actorRole, action)) {
        action.approvals.push({ role: op.actorRole as Exclude<Role, 'viewer'>, at: op.at });
        action.revision += 1;
        action.updatedAt = op.at;
        pending.actions.add(action.id);
        if (action.kind === 'isolate' && meetsIsolationRule(next.rolePolicies, action)) action.status = 'approved';
      }
      addTimeline(next, localEvent(`审批处置动作：${action?.title ?? op.actionId}（待同步）`, action?.sensitive === true));
      break;
    }
    case 'edit-action': {
      const action = next.incident.actions.find((item) => item.id === op.actionId);
      if (action && action.status !== 'executed' && action.status !== 'executing') {
        action.title = op.title;
        action.sensitive = op.sensitive;
        action.revision += 1;
        action.updatedAt = op.at;
        pending.actions.add(action.id);
        if (action.kind === 'isolate' && !meetsIsolationRule(next.rolePolicies, action)) action.status = 'invalid';
      }
      addTimeline(next, localEvent(`修改处置动作：${action?.title ?? op.actionId}（待同步）`, action?.sensitive === true));
      break;
    }
    case 'execute-request': {
      const action = next.incident.actions.find((item) => item.id === op.actionId);
      if (action && action.status !== 'executed' && action.status !== 'invalid' && (!action.execution || action.execution.state === 'failed')) {
        action.status = 'executing';
        action.execution = { id: op.receiptId, requestOpId: op.id, ownerClientId: op.clientId, actorRole: op.actorRole, at: op.at, attempts: 1, state: 'pending_ack' };
        pending.actions.add(action.id);
      }
      addTimeline(next, localEvent(`发起执行（网络恢复后发送）：${action?.title ?? op.actionId}`, action?.sensitive === true));
      break;
    }
    case 'execute-confirm': {
      const action = next.incident.actions.find((item) => item.id === op.actionId);
      if (action?.execution) {
        action.status = 'executing';
        action.execution.state = 'pending_ack';
        action.execution.attempts += 1;
        pending.actions.add(action.id);
      }
      addTimeline(next, localEvent(`执行回执重试（待同步）：${action?.title ?? op.actionId}`, action?.sensitive === true));
      break;
    }
    case 'execute-result': {
      const action = next.incident.actions.find((item) => item.id === op.actionId);
      if (action?.execution) {
        action.execution.attempts = op.attempts;
        if (op.outcome === 'success') {
          action.status = 'executed';
          action.execution.state = 'succeeded';
        } else {
          action.status = 'failed';
          action.execution.state = 'failed';
          action.execution.lastError = op.error;
        }
        pending.actions.add(action.id);
      }
      addTimeline(next, localEvent(op.outcome === 'success' ? '执行完成（待同步）' : '执行失败，回执待同步', action?.sensitive === true));
      break;
    }
    case 'update-policy': {
      next.rolePolicies = structuredClone(op.policies);
      next.incident.actions.forEach((item) => {
        if (item.kind === 'isolate' && ['pending', 'approved', 'executing'].includes(item.status) && !meetsIsolationRule(next.rolePolicies, item)) {
          item.status = 'invalid';
          pending.actions.add(item.id);
        }
      });
      addTimeline(next, localEvent(`角色权限策略已更新：${op.summary}（待同步）`));
      break;
    }
  }
  return next;
}

export interface LocalView {
  snapshot: CollabSnapshot;
  pendingTimeline: Set<string>;
  pendingActions: Set<string>;
  pendingSubs: Set<string>;
}

export function buildLocalView(snapshot: CollabSnapshot, queue: QueuedOperation[]): LocalView {
  const pending: PendingSets = { timeline: new Set(), actions: new Set(), subs: new Set() };
  const processed = new Set(snapshot.incident.processedOperationIds);
  const active = queue.filter((item) => item.status === 'queued' && !processed.has(item.op.id));
  const derived = active.reduce((current, queued) => applyLocalOp(current, queued, pending), structuredClone(snapshot));
  return {
    snapshot: derived,
    pendingTimeline: pending.timeline,
    pendingActions: pending.actions,
    pendingSubs: pending.subs
  };
}

const SERVER_KEY = 'yf56-collab-server-v1';
const CHANNEL_NAME = 'yf56-collab-channel';

export function readRemoteSnapshot(): CollabSnapshot {
  if (typeof window === 'undefined') return createInitialSnapshot();
  const raw = window.localStorage.getItem(SERVER_KEY);
  if (!raw) {
    const initial = createInitialSnapshot();
    writeRemoteSnapshot(initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(raw) as CollabSnapshot;
    if (parsed.version !== 1 || !parsed.incident) return createInitialSnapshot();
    parsed.incident.processedOperationIds ??= [];
    parsed.conflicts ??= [];
    parsed.incident.actionOrder ??= parsed.incident.actions.map((action) => action.id);
    return parsed;
  } catch {
    return createInitialSnapshot();
  }
}

export function writeRemoteSnapshot(snapshot: CollabSnapshot) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SERVER_KEY, JSON.stringify(snapshot));
}

export function createChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

export function postSnapshot(channel: BroadcastChannel | null, snapshot: CollabSnapshot, clientId: string) {
  writeRemoteSnapshot(snapshot);
  channel?.postMessage({ type: 'snapshot', clientId, snapshot });
}
