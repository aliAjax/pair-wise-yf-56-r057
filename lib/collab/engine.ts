import type { ActionKind, CollabState, Incident, Op, OpResult, Policy, ResponseAction, Role, RolePerms, SubIncident, TimelineEvent } from './types';

export const ROLE_ORDER: Role[] = ['analyst', 'responder', 'legal', 'viewer'];
export const ROLE_LABELS: Record<Role, string> = { analyst: '分析员', responder: '响应负责人', legal: '法务/公关', viewer: '访客' };
export const KIND_LABELS: Record<ActionKind, string> = { isolate: '隔离', block: '封禁', restore: '恢复', notify: '通报' };

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultPolicy(): Policy {
  return {
    v: 1,
    rolePerms: {
      analyst: { approve: true, execute: false, seeSensitive: false },
      responder: { approve: true, execute: true, seeSensitive: true },
      legal: { approve: true, execute: false, seeSensitive: true },
      viewer: { approve: false, execute: false, seeSensitive: false }
    }
  };
}

function seed(): CollabState {
  const now = Date.now();
  const at = (offsetMin: number) => new Date(now - offsetMin * 60000).toISOString();
  const actions: ResponseAction[] = [
    { id: 'act-1', v: 1, title: '隔离异常网关节点', kind: 'isolate', sensitive: true, order: 0, status: 'pending',
      approvals: [{ role: 'responder', at: at(40), op: 'seed' }],
      history: [{ v: 1, title: '隔离异常网关节点', kind: 'isolate', sensitive: true, at: at(40), by: 'responder', op: 'seed' }], conflicts: [] },
    { id: 'act-2', v: 1, title: '封禁可疑出口地址', kind: 'block', sensitive: false, order: 1, status: 'pending',
      approvals: [], history: [{ v: 1, title: '封禁可疑出口地址', kind: 'block', sensitive: false, at: at(30), by: 'responder', op: 'seed' }], conflicts: [] },
    { id: 'act-3', v: 1, title: '准备客户披露口径', kind: 'notify', sensitive: true, order: 2, status: 'approved',
      approvals: [{ role: 'legal', at: at(20), op: 'seed' }],
      history: [{ v: 1, title: '准备客户披露口径', kind: 'notify', sensitive: true, at: at(20), by: 'legal', op: 'seed' }], conflicts: [] }
  ];
  const subIncidents: SubIncident[] = [
    { id: 'sub-1', v: 1, title: '异常会话来源分析', owner: '分析组', status: 'open' },
    { id: 'sub-2', v: 1, title: '受影响租户范围确认', owner: '平台组', status: 'open' }
  ];
  const timeline: TimelineEvent[] = [
    { id: 'e1', v: 1, at: at(25), actor: '告警平台', text: '检测到同一凭证跨三个地域登录', sensitive: true },
    { id: 'e2', v: 1, at: at(15), actor: '值班分析员', text: '确认会话未经过常规办公出口' }
  ];
  const incident: Incident = {
    id: 'INC-2026-0929', v: 1, title: '对外网关异常凭证使用', severity: 'critical', status: 'investigating',
    affected: ['api-gateway', 'customer-portal', 'audit-log'], subIncidents, actions, timeline
  };
  return { incident, policy: defaultPolicy(), appliedOps: [] };
}

export function initialState(): CollabState {
  return seed();
}

function pushTimeline(s: CollabState, ev: { actor: string; text: string; sensitive?: boolean; at?: string }) {
  s.incident.timeline = [{ id: uid('e'), v: 1, at: ev.at ?? new Date().toISOString(), actor: ev.actor, text: ev.text, sensitive: ev.sensitive }, ...s.incident.timeline].slice(0, 30);
}

/** 统计动作当前有效的审批：角色仍持有审批权，且敏感动作要求审批人具备敏感可见权。 */
function validApprovals(a: ResponseAction, policy: Policy) {
  return a.approvals.filter((ap) => policy.rolePerms[ap.role]?.approve && (!a.sensitive || policy.rolePerms[ap.role]?.seeSensitive));
}

function needs(a: ResponseAction): number {
  return a.kind === 'isolate' ? 2 : 1;
}

/** 权限或敏感级别变化后重校验：已批准动作若不再满足条件立即失效；已执行结果保留。 */
function revalidateAction(a: ResponseAction, policy: Policy) {
  if (a.status === 'executed') return;
  const distinct = new Set(validApprovals(a, policy).map((ap) => ap.role));
  if (distinct.size >= needs(a)) {
    if (a.status === 'invalid') a.status = 'approved';
  } else if (a.status === 'approved') {
    a.status = 'invalid';
  }
}

/** 纯函数：把操作应用到状态上。服务端（权威）与客户端（乐观更新/远端回放）共用同一逻辑。 */
export function applyOp(state: CollabState, op: Op): { state: CollabState; result: OpResult } {
  if (state.appliedOps.includes(op.id)) return { state, result: { ok: true, idempotent: true } };
  const s: CollabState = structuredClone(state);
  let result: OpResult = { ok: true };
  let changed = true;

  switch (op.type) {
    case 'addSubIncident': {
      s.incident.subIncidents = [...s.incident.subIncidents, { id: uid('sub'), v: 1, title: op.title, owner: op.owner, status: 'open' }];
      pushTimeline(s, { actor: ROLE_LABELS[op.by], text: `创建子事件：${op.title}` });
      break;
    }
    case 'editAction': {
      const a = s.incident.actions.find((item) => item.id === op.entityId);
      if (!a) { result = { ok: false, error: '处置动作不存在', retryable: false }; changed = false; break; }
      if (a.status === 'executed') { result = { ok: false, error: '已执行的动作不可修改', retryable: false }; changed = false; break; }
      if (a.v !== op.baseV) {
        const conflict = { id: uid('cf'), v: a.v, patch: op.patch, by: op.by, at: op.at, op: op.id };
        a.conflicts = [conflict, ...a.conflicts];
        pushTimeline(s, { actor: ROLE_LABELS[op.by], text: `编辑冲突：处置动作「${a.title}」基于旧版本 v${op.baseV} 的修改未被覆盖，已保留为冲突版本（当前 v${a.v}）` });
        result = { ok: false, conflict };
        break;
      }
      if (op.patch.title !== undefined) a.title = op.patch.title;
      if (op.patch.kind !== undefined) a.kind = op.patch.kind;
      if (op.patch.sensitive !== undefined) a.sensitive = op.patch.sensitive;
      a.v += 1;
      a.history.push({ v: a.v, title: a.title, kind: a.kind, sensitive: a.sensitive, at: op.at, by: op.by, op: op.id });
      pushTimeline(s, { actor: ROLE_LABELS[op.by], text: `编辑处置动作：${a.title}（v${a.v}）`, sensitive: a.sensitive });
      revalidateAction(a, s.policy);
      break;
    }
    case 'approve': {
      const a = s.incident.actions.find((item) => item.id === op.entityId);
      if (!a) { result = { ok: false, error: '处置动作不存在', retryable: false }; changed = false; break; }
      if (a.status === 'executed') { result = { ok: true, idempotent: true }; break; }
      if (!s.policy.rolePerms[op.by]?.approve) { result = { ok: false, error: '当前角色无审批权限', retryable: false }; changed = false; break; }
      if (a.sensitive && !s.policy.rolePerms[op.by]?.seeSensitive) { result = { ok: false, error: '敏感动作需具备敏感内容可见权限的角色审批', retryable: false }; changed = false; break; }
      if (a.approvals.some((ap) => ap.role === op.by)) { result = { ok: true, idempotent: true }; break; }
      a.approvals.push({ role: op.by, at: op.at, op: op.id });
      const distinct = new Set(validApprovals(a, s.policy).map((ap) => ap.role));
      a.status = distinct.size >= needs(a) ? 'approved' : 'pending';
      pushTimeline(s, { actor: ROLE_LABELS[op.by], text: `审批处置动作：${a.title}（${ROLE_LABELS[op.by]}，当前 ${distinct.size}/${needs(a)} 个不同角色）`, sensitive: a.sensitive });
      break;
    }
    case 'execute': {
      const a = s.incident.actions.find((item) => item.id === op.entityId);
      if (!a) { result = { ok: false, error: '处置动作不存在', retryable: false }; changed = false; break; }
      if (a.status === 'executed') { result = { ok: true, idempotent: true }; break; }
      if (!s.policy.rolePerms[op.by]?.execute) { result = { ok: false, error: '当前角色无执行权限', retryable: false }; changed = false; break; }
      if (a.status === 'invalid') { result = { ok: false, error: '动作已失效：执行条件不再满足，请重新发起审批', retryable: false }; changed = false; break; }
      const distinct = new Set(validApprovals(a, s.policy).map((ap) => ap.role));
      if (distinct.size < needs(a)) {
        result = { ok: false, error: `条件不满足：${a.kind === 'isolate' ? '隔离动作需两名不同角色的有效审批' : '需一名具备权限的审批人'}（当前 ${distinct.size}/${needs(a)}）`, retryable: false };
        changed = false;
        break;
      }
      a.status = 'executed';
      a.executedAt = op.at;
      a.executedBy = op.by;
      a.executeOp = op.id;
      pushTimeline(s, { actor: ROLE_LABELS[op.by], text: `执行处置动作：${a.title}`, sensitive: a.sensitive });
      break;
    }
    case 'reorder': {
      s.incident.actions = s.incident.actions
        .map((a) => { const idx = op.order.indexOf(a.id); return idx >= 0 ? { ...a, order: idx } : a; })
        .sort((x, y) => x.order - y.order);
      break;
    }
    case 'policyChange': {
      s.policy = structuredClone(s.policy);
      s.policy.rolePerms[op.role] = { ...s.policy.rolePerms[op.role], ...op.perms };
      s.policy.v += 1;
      for (const a of s.incident.actions) {
        if (a.status === 'executed') continue;
        const before = a.status;
        revalidateAction(a, s.policy);
        if (before === 'approved' && a.status === 'invalid') {
          pushTimeline(s, { actor: '系统', text: `处置动作失效：「${a.title}」在权限策略或敏感级别变更后不再满足执行条件，已执行结果与历史时间线保留不变`, sensitive: a.sensitive });
        }
      }
      pushTimeline(s, { actor: '系统', text: `权限策略变更：${ROLE_LABELS[op.role]} 的权限已调整` });
      break;
    }
    case 'tick': {
      pushTimeline(s, { actor: '监测代理', text: `实时检查：${s.incident.affected.length} 项资产状态已更新，协同通道正常` });
      break;
    }
  }

  if (changed) s.incident.v += 1;
  s.appliedOps = [...s.appliedOps, op.id].slice(-200);
  return { state: s, result };
}
