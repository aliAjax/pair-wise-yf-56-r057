'use client';
export const dynamic = 'force-dynamic';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, CloudOff, Eye, Radio, RefreshCw, Save, ShieldAlert, UserCheck, Users, Wifi } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { buildLocalView, canApproveAction, canViewSensitive, isApprovalValid, roleNames, statusNames, validApprovals, type ActionKind, type ConflictRecord, type ResponseAction, type Role, type RolePolicyMap, type SubIncident } from '@/lib/collab';
import { canEditPolicies, useIncidentStore } from '@/lib/store';

const kindNames: Record<ActionKind, string> = { isolate: '隔离', block: '封禁', restore: '恢复', notify: '通知' };
const subStatusNames: Record<SubIncident['status'], string> = { open: '处理中', contained: '已遏制', closed: '已关闭' };
const incidentStatuses: Array<'investigating' | 'contained' | 'recovered'> = ['investigating', 'contained', 'recovered'];
const incidentStatusNames = { investigating: '调查中', contained: '已遏制', recovered: '已恢复' };
const allKinds: ActionKind[] = ['isolate', 'block', 'restore', 'notify'];

function SortableAction({
  action,
  pending,
  role,
  policies,
  conflicts,
  demoMode,
  onApprove,
  onExecute,
  onRetry,
  onSave,
  onResolveConflict
}: {
  action: ResponseAction;
  pending: boolean;
  role: Role;
  policies: RolePolicyMap;
  conflicts: ConflictRecord[];
  demoMode: boolean;
  onApprove: (id: string) => void;
  onExecute: (id: string) => void;
  onRetry: (id: string) => void;
  onSave: (id: string, revision: number, payload: { title: string; sensitive: boolean }) => void;
  onResolveConflict: (id: string) => void;
}) {
  const sortable = useSortable({ id: action.id });
  const [title, setTitle] = useState(action.title);
  const [sensitive, setSensitive] = useState(action.sensitive === true);
  const [baseRevision, setBaseRevision] = useState(action.revision);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setTitle(action.title);
    setSensitive(action.sensitive === true);
  }, [action.id]);

  const canSee = canViewSensitive(policies, role);
  const visibleTitle = canSee ? action.title : '敏感处置动作（当前角色不可见）';
  const valid = validApprovals(policies, action);
  const alreadyApproved = action.approvals.some((approval) => approval.role === role);
  const canApprove = !demoMode && role !== 'viewer' && canApproveAction(policies, role, action) && !alreadyApproved && !['executed', 'executing', 'invalid', 'failed'].includes(action.status);
  const canExecute = !demoMode && role !== 'viewer' && !['executed', 'executing', 'invalid', 'failed'].includes(action.status) && (action.kind !== 'isolate' || valid.length >= 2);
  const actionConflicts = conflicts.filter((item) => item.actionId === action.id);

  return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="action-row">
    <div className="action-main">
      <div className="action-title-line">
        <strong>{visibleTitle}</strong>
        {pending && <Badge className="warning">待同步</Badge>}
        <Badge className={action.status === 'invalid' ? 'danger' : action.status === 'executed' ? 'success' : action.status === 'failed' ? 'danger' : ''}>{statusNames[action.status]}</Badge>
      </div>
      <div className="muted">{kindNames[action.kind]} · v{action.revision} · 有效审批 {valid.length}{action.kind === 'isolate' ? '/2' : ''} · {action.sensitive ? '敏感' : '普通'}</div>
      {action.approvals.length > 0 && <div className="approval-list">
        {action.approvals.map((approval) => <Badge key={`${approval.role}-${approval.at}`} className={isApprovalValid(policies, action, approval) ? 'success soft' : 'danger soft'}>
          {roleNames[approval.role]}{isApprovalValid(policies, action, approval) ? '有效' : '已失效'}
        </Badge>)}
      </div>}
      {action.status === 'invalid' && action.kind === 'isolate' && <p className="inline-error"><AlertTriangle size={14} /> 有效双人审批条件不再满足，动作立即失效；历史审批和时间线仍保留。</p>}
      {action.execution?.state === 'failed' && <p className="inline-error"><AlertTriangle size={14} /> {action.execution.lastError || '执行失败'} · 回执 {action.execution.id.slice(0, 12)} · 第 {action.execution.attempts} 次</p>}
      {action.execution?.state === 'pending_ack' && <p className="inline-warning"><Radio size={14} /> 已取得执行请求回执，正在等待执行器确认，不能重复提交。</p>}
      {editing && canSee ? <div className="edit-panel">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        <label className="check"><input type="checkbox" checked={sensitive} onChange={(event) => setSensitive(event.target.checked)} />敏感动作</label>
        <Button size="sm" onClick={() => { onSave(action.id, baseRevision, { title, sensitive }); setEditing(false); }}><Save size={14} />提交版本</Button>
      </div> : canSee && !demoMode && ['pending', 'approved'].includes(action.status) && <Button size="sm" variant="ghost" onClick={() => { setBaseRevision(action.revision); setTitle(action.title); setSensitive(action.sensitive === true); setEditing(true); }}>基于 v{action.revision} 修改</Button>}
      {actionConflicts.length > 0 && <div className="conflict-box">
        {actionConflicts.map((conflict) => <div key={conflict.id}>
          <strong><AlertTriangle size={14} /> 版本冲突：本页基于 v{conflict.expectedRevision}，当前已是 v{conflict.actualRevision}</strong>
          <div className="conflict-versions"><div><span>本页版本</span><p>{conflict.incoming.title} · {conflict.incoming.sensitive ? '敏感' : '普通'}</p></div><div><span>当前版本</span><p>{conflict.remote.title} · {conflict.remote.sensitive ? '敏感' : '普通'}</p></div></div>
          <div className="conflict-footer"><small>{conflict.actor} · {formatDistanceToNow(new Date(conflict.at), { addSuffix: true, locale: zhCN })}</small><Button size="sm" variant="ghost" onClick={() => onResolveConflict(conflict.id)}>标记已核对</Button></div>
        </div>)}
      </div>}
    </div>
    <div className="row-actions">
      <Button size="sm" variant="outline" disabled={!canApprove} onClick={() => onApprove(action.id)}><UserCheck size={14} />审批</Button>
      {action.status === 'failed' && action.execution?.state === 'failed'
        ? <Button size="sm" variant="outline" disabled={demoMode || role === 'viewer'} onClick={() => onRetry(action.id)}><RefreshCw size={14} />凭回执重试</Button>
        : <Button size="sm" disabled={!canExecute} onClick={() => onExecute(action.id)}>执行</Button>}
      <Button size="sm" variant="ghost" {...sortable.attributes} {...sortable.listeners}>排序</Button>
    </div>
  </div>;
}

function PolicyEditor({ policies, demoMode, onSave }: { policies: RolePolicyMap; demoMode: boolean; onSave: (policies: RolePolicyMap) => void }) {
  const [draft, setDraft] = useState<RolePolicyMap>(structuredClone(policies));
  useEffect(() => setDraft(structuredClone(policies)), [policies]);
  const roles = Object.keys(draft) as Array<Exclude<Role, 'viewer'>>;

  return <div className="policy-grid">
    {roles.map((role) => <div key={role} className="policy-row">
      <strong>{draft[role].label}</strong>
      <div className="kind-checks">{allKinds.map((kind) => <label key={kind} className="check"><input type="checkbox" checked={draft[role].canApproveKinds.includes(kind)} disabled={demoMode} onChange={(event) => setDraft((value) => {
        const next = structuredClone(value);
        next[role].canApproveKinds = event.target.checked ? [...next[role].canApproveKinds, kind] : next[role].canApproveKinds.filter((item) => item !== kind);
        return next;
      })} />{kindNames[kind]}</label>)}</div>
      <label className="check"><input type="checkbox" checked={draft[role].sensitiveClearance} disabled={demoMode} onChange={(event) => setDraft((value) => ({ ...value, [role]: { ...value[role], sensitiveClearance: event.target.checked } }))} />敏感可见/审批</label>
    </div>)}
    <Button size="sm" disabled={demoMode} onClick={() => onSave(draft)}><Save size={14} />应用权限</Button>
  </div>;
}

export default function Page() {
  const t = useTranslations();
  const store = useIncidentStore();
  const view = useMemo(() => buildLocalView(store.snapshot, store.queue), [store.snapshot, store.queue]);
  const incident = view.snapshot.incident;
  const policies = view.snapshot.rolePolicies;
  const sensors = useSensors(useSensor(PointerSensor));
  const [subTitle, setSubTitle] = useState('');
  const [subOwner, setSubOwner] = useState('');
  const [note, setNote] = useState('');
  const [noteSensitive, setNoteSensitive] = useState(false);
  const [subError, setSubError] = useState('');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!store.demoMode) store.tick(); }, 20000);
    return () => window.clearInterval(timer);
  }, [store.demoMode, store]);

  function dragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const ids = incident.actions.map((action) => action.id);
    const activeId = String(event.active.id);
    const overId = String(event.over?.id);
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    store.reorderActions(next);
  }

  function createSubIncident() {
    if (subTitle.trim().length < 4) { setSubError('请填写至少 4 个字的子事件名称'); return; }
    if (subOwner.trim().length < 2) { setSubError('请填写负责组'); return; }
    store.addSubIncident({ title: subTitle.trim(), owner: subOwner.trim() });
    setSubTitle(''); setSubOwner(''); setSubError('');
  }

  function cycleSubStatus(sub: SubIncident) {
    const order: Array<SubIncident['status']> = ['open', 'contained', 'closed'];
    const next = order[(order.indexOf(sub.status) + 1) % order.length];
    store.updateSubIncident(sub.id, { status: next });
  }

  const orderedActions = incident.actionOrder.map((id) => incident.actions.find((action) => action.id === id)).filter((action): action is ResponseAction => Boolean(action));
  const canSeeSensitive = canViewSensitive(policies, store.role);
  const queuedCount = store.queue.filter((item) => item.status === 'queued').length;
  const unresolvedConflicts = view.snapshot.conflicts.filter((item) => !item.resolved);

  if (!mounted) return <main className="shell loading-shell"><Card><CardContent><strong>正在载入离线协同作战室…</strong></CardContent></Card></main>;

  return <main className="shell">
    <header className="topbar">
      <div><span className="eyebrow"><Radio size={14} /> OFFLINE-FIRST WAR ROOM · PORT 62021</span><h1>{t('title')}</h1><p>按事件、动作和操作标识合并；冲突保留两版，执行回执幂等重试</p></div>
      <div className="controls">
        <select value={store.role} onChange={(event) => store.setRole(event.target.value as Role)}>{Object.entries(roleNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <Button variant={store.demoMode ? 'danger' : 'outline'} onClick={store.toggleDemo}><Eye size={16} />{store.demoMode ? '退出演示' : t('demo')}</Button>
      </div>
    </header>
    {store.demoMode && <div className="demo-banner">只读演示模式已开启：审批、执行、拖拽、新增和权限调整均被冻结，仍可查看允许范围内的内容和冲突记录。</div>}

    <section className="metrics">
      <Card><CardContent><span>当前事件</span><strong>{incident.id}</strong><Badge className="critical">{incident.severity}</Badge></CardContent></Card>
      <Card><CardContent><span>协同通道</span><strong className={store.online ? 'online-text' : 'offline-text'}>{store.online ? <Wifi size={22} /> : <CloudOff size={22} />}{store.online ? '在线' : '离线'}</strong><small>{store.online ? '操作立即提交并广播' : '本地续作，恢复后重放'}</small></CardContent></Card>
      <Card><CardContent><span>待确认/待同步</span><strong>{queuedCount}</strong><small>{store.queue.filter((item) => item.op.type.startsWith('execute')).length} 条执行相关</small></CardContent></Card>
      <Card><CardContent><span>未处理冲突</span><strong>{unresolvedConflicts.length}</strong><small>后提交不会覆盖先提交</small></CardContent></Card>
    </section>

    {!store.demoMode && <Card className="network-card"><CardContent className="network-controls">
      <div><strong>网络与执行器模拟</strong><p className="muted">离线标签页可继续操作；恢复后按稳定 ID 合并。执行失败只保留失败回执，重试不会重复执行已成功动作。</p></div>
      <Button size="sm" variant={store.forceOffline ? 'danger' : 'outline'} onClick={() => store.setForceOffline(!store.forceOffline)}>{store.forceOffline ? <CloudOff size={14} /> : <Wifi size={14} />}{store.forceOffline ? '模拟离线中' : '强制离线'}</Button>
      <label className="check"><input type="checkbox" checked={store.simulateFailureNext} onChange={(event) => store.setSimulateFailureNext(event.target.checked)} />下一次执行返回失败</label>
    </CardContent></Card>}

    <section className="grid">
      <div className="stack">
        <Card>
          <CardHeader><div><h2>事件摘要</h2><p className="muted">影响范围：{incident.affected.join(' · ')}</p></div><ShieldAlert color={incident.severity === 'critical' ? '#ef4444' : '#f59e0b'} /></CardHeader>
          <CardContent>
            <div className="incident-state"><span>主事件阶段（v{incident.revision}）</span><div className="segmented">{incidentStatuses.map((status) => <button key={status} disabled={store.demoMode} className={incident.status === status ? 'active' : ''} onClick={() => store.updateIncidentStatus(status)}>{incidentStatusNames[status]}</button>)}</div></div>
            <h3>子事件</h3>
            {incident.subIncidents.map((item) => <div className="sub-row" key={item.id}><div><strong>{item.title} {view.pendingSubs.has(item.id) && <Badge className="warning">待同步</Badge>}</strong><div className="muted">{item.owner} · v{item.revision}</div></div><Button size="sm" variant="outline" disabled={store.demoMode} onClick={() => cycleSubStatus(item)}>{subStatusNames[item.status]}</Button></div>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><h2>{t('approval')}</h2><p className="muted">隔离动作必须有来自不同角色的两次有效审批；权限或敏感级别变化后待执行动作立即失效。</p></div><Users size={20} /></CardHeader>
          <CardContent><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={orderedActions.map((action) => action.id)} strategy={verticalListSortingStrategy}><div>{orderedActions.map((action) => <SortableAction key={action.id} action={action} pending={view.pendingActions.has(action.id)} role={store.role} policies={policies} conflicts={unresolvedConflicts} demoMode={store.demoMode} onApprove={store.approveAction} onExecute={store.executeAction} onRetry={store.retryReceipt} onSave={store.saveAction} onResolveConflict={store.resolveConflict} />)}</div></SortableContext></DndContext></CardContent>
        </Card>

        <Card>
          <CardHeader><div><h2>角色权限与敏感级别</h2><p className="muted">调整会广播为一次策略变更；不满足隔离双人规则的待执行动作马上失效，历史不擦除。</p></div></CardHeader>
          <CardContent>{canEditPolicies(store.role) ? <PolicyEditor policies={policies} demoMode={store.demoMode} onSave={(next) => store.updatePolicies(next, '值班主管调整审批权限')} /> : <p className="muted">访客只能查看权限策略，不能修改。</p>}</CardContent>
        </Card>
      </div>

      <div className="stack">
        <Card><CardHeader><h2>新增子事件</h2></CardHeader><CardContent>
          <label>子事件名称<Input value={subTitle} onChange={(event) => setSubTitle(event.target.value)} placeholder="例如：凭据轮换" /></label>
          <label>负责组<Input value={subOwner} onChange={(event) => setSubOwner(event.target.value)} placeholder="例如：平台组" /></label>
          {subError && <small className="error">{subError}</small>}
          <Button disabled={store.demoMode} onClick={createSubIncident}><ShieldAlert size={16} />创建子事件</Button>
        </CardContent></Card>

        <Card><CardHeader><h2>追加时间线记录</h2></CardHeader><CardContent>
          <label>记录内容<Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：已通知网关值班组" /></label>
          <label className="check"><input type="checkbox" checked={noteSensitive} onChange={(event) => setNoteSensitive(event.target.checked)} disabled={!canSeeSensitive} />敏感记录</label>
          <Button variant="outline" disabled={store.demoMode || note.trim().length === 0} onClick={() => { store.addTimelineNote({ text: note.trim(), sensitive: noteSensitive && canSeeSensitive }); setNote(''); setNoteSensitive(false); }}>加入时间线</Button>
        </CardContent></Card>

        <Card><CardHeader><div><h2>离线待确认回执</h2><p className="muted">按操作 ID 幂等提交，冲突和拒绝会保留原因。</p></div>{queuedCount > 0 ? <CloudOff /> : <CheckCircle2 color="#16a34a" />}</CardHeader><CardContent>
          {store.queue.length === 0 ? <p className="muted">当前没有待同步操作。</p> : <div className="queue-list">{store.queue.map((item) => <div className="queue-row" key={item.op.id}>
            <div><strong>{item.status === 'queued' ? '待发送' : item.status === 'conflicted' ? '冲突，两版已保留' : '服务端拒绝'}</strong><p className="muted">{item.op.type} · {item.op.id.slice(0, 16)}{item.code ? ` · ${item.code}` : ''}</p></div>
            {item.status !== 'queued' && <Button size="sm" variant="ghost" onClick={() => store.dismissQueueEntry(item.op.id)}>知道了</Button>}
          </div>)}</div>}
        </CardContent></Card>

        <Card className="timeline-card"><CardHeader><div><h2>{t('timeline')}</h2><p className="muted">所有标签页的事件、子事件、动作和审批按唯一标识追加合并</p></div><Radio color="#ef4444" /></CardHeader><CardContent><div className="timeline">{incident.timeline.map((eventItem) => <article key={eventItem.id}><i /><div><div className="timeline-meta"><strong>{eventItem.actor}</strong><span>{formatDistanceToNow(new Date(eventItem.at), { addSuffix: true, locale: zhCN })}</span></div><p>{eventItem.sensitive && !canSeeSensitive ? '敏感处置记录已隐藏' : eventItem.text}{eventItem.pending && <Badge className="warning">待同步</Badge>}</p></div></article>)}</div></CardContent></Card>
      </div>
    </section>
  </main>;
}
