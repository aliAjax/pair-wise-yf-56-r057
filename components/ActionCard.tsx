'use client';
import { CheckCircle2, Pencil, RefreshCw, ShieldAlert, UserCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { KIND_LABELS, ROLE_LABELS } from '@/lib/collab/engine';
import type { ActionKind, ResponseAction } from '@/lib/collab/types';
import { useIncidentStore } from '@/lib/store';

const KINDS: ActionKind[] = ['isolate', 'block', 'restore', 'notify'];

function statusMeta(status: ResponseAction['status']) {
  switch (status) {
    case 'pending': return { label: '待审批', cls: 'badge-pending' };
    case 'approved': return { label: '已批准待执行', cls: 'badge-approved' };
    case 'executed': return { label: '已执行', cls: 'badge-executed' };
    case 'invalid': return { label: '已失效', cls: 'badge-invalid' };
  }
}

export function ActionCard({ action }: { action: ResponseAction }) {
  const store = useIncidentStore();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(action.title);
  const [kind, setKind] = useState<ActionKind>(action.kind);
  const [sensitive, setSensitive] = useState(action.sensitive);

  const perms = store.policy.rolePerms[store.role];
  const canSee = !action.sensitive || perms.seeSensitive;
  const need = action.kind === 'isolate' ? 2 : 1;
  const distinctRoles = new Set(action.approvals.map((a) => a.role)).size;
  const alreadyApproved = action.approvals.some((a) => a.role === store.role);
  const meta = statusMeta(action.status);

  const approveDisabled = store.demoMode || store.role === 'viewer' || alreadyApproved || action.status === 'executed'
    || !perms.approve || (action.sensitive && !perms.seeSensitive);
  const approveHint = alreadyApproved ? '当前角色已审批，重复审批不会生效'
    : !perms.approve ? '当前角色无审批权限'
    : action.sensitive && !perms.seeSensitive ? '敏感动作需具备敏感内容可见权限的角色审批'
    : '';
  const executeDisabled = store.demoMode || store.role === 'viewer' || !perms.execute || action.status !== 'approved';

  function save() {
    const patch: { title?: string; kind?: ActionKind; sensitive?: boolean } = {};
    if (title.trim() && title.trim() !== action.title) patch.title = title.trim();
    if (kind !== action.kind) patch.kind = kind;
    if (sensitive !== action.sensitive) patch.sensitive = sensitive;
    if (Object.keys(patch).length > 0) store.editAction(action.id, patch);
    setEditing(false);
  }

  return (
    <div className={`action-card ${action.status === 'invalid' ? 'is-invalid' : ''}`}>
      <div className="action-head">
        <div className="action-title-row">
          <strong>{canSee ? action.title : '敏感处置动作（当前角色不可见）'}</strong>
          <Badge className={meta.cls}>{meta.label}</Badge>
          <Badge className="badge-version">v{action.v}</Badge>
          {action.sensitive && <Badge className="badge-sensitive">敏感</Badge>}
        </div>
        <div className="muted action-meta">
          {KIND_LABELS[action.kind]} · 审批 {distinctRoles}/{need} 个不同角色
          {action.approvals.length > 0 && `：${action.approvals.map((a) => ROLE_LABELS[a.role]).join('、')}`}
          {action.status === 'executed' && action.executedBy && ` · 由 ${ROLE_LABELS[action.executedBy]} 执行`}
        </div>
      </div>

      {action.conflicts.length > 0 && (
        <div className="conflict-box">
          <div className="conflict-title"><ShieldAlert size={14} /> 检测到 {action.conflicts.length} 个基于旧版本的冲突修改，两版均已保留</div>
          {action.conflicts.map((c) => (
            <div key={c.id} className="conflict-version">
              <strong>冲突版本 v{c.v}</strong>（{ROLE_LABELS[c.by]} 于 {new Date(c.at).toLocaleTimeString('zh-CN')} 基于旧版本提交）：
              {c.patch.title !== undefined && <span> 标题「{c.patch.title}」</span>}
              {c.patch.kind !== undefined && <span> 类型「{KIND_LABELS[c.patch.kind]}」</span>}
              {c.patch.sensitive !== undefined && <span> 敏感{c.patch.sensitive ? '开启' : '关闭'}</span>}
              <div className="muted">当前保留版本为 v{action.v}「{action.title}」。冲突内容未被静默覆盖，可由责任人核对后重新提交。</div>
            </div>
          ))}
        </div>
      )}

      {action.status === 'invalid' && (
        <div className="invalid-note"><XCircle size={14} /> 执行条件已失效：权限策略或敏感级别变化后不再满足审批要求。已执行结果与历史时间线保留不变，可重新审批后再执行。</div>
      )}

      {editing ? (
        <div className="edit-form">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="处置动作标题" />
          <div className="edit-row">
            <select value={kind} onChange={(e) => setKind(e.target.value as ActionKind)}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} /> 敏感动作</label>
          </div>
          <div className="row-actions">
            <Button size="sm" onClick={save} disabled={!title.trim()}><CheckCircle2 size={14} />保存为新版本</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setTitle(action.title); setKind(action.kind); setSensitive(action.sensitive); }}>取消</Button>
          </div>
        </div>
      ) : (
        <div className="row-actions">
          <Button size="sm" variant="outline" disabled={approveDisabled} onClick={() => store.approveAction(action.id)} title={approveHint}>
            <UserCheck size={14} />审批
          </Button>
          <Button size="sm" disabled={executeDisabled} onClick={() => store.executeAction(action.id)}
            title={action.status === 'executed' ? '已执行，重复执行不会生效' : action.status === 'invalid' ? '动作已失效' : distinctRoles < need ? `还需 ${need - distinctRoles} 个不同角色审批` : ''}>
            {action.status === 'executed' ? <CheckCircle2 size={14} /> : <RefreshCw size={14} />}执行
          </Button>
          <Button size="sm" variant="ghost" disabled={store.demoMode || action.status === 'executed'} onClick={() => setEditing(true)}>
            <Pencil size={14} />编辑
          </Button>
        </div>
      )}
    </div>
  );
}
