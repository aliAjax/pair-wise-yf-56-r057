'use client';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Eye, GripVertical, Radio, ShieldAlert, Users, Wifi, WifiOff } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ActionCard } from '@/components/ActionCard';
import { OutboxPanel } from '@/components/OutboxPanel';
import { PolicyPanel } from '@/components/PolicyPanel';
import { ROLE_LABELS } from '@/lib/collab/engine';
import { useIncidentStore } from '@/lib/store';

const formSchema = z.object({ title: z.string().min(4, '请填写至少4个字的子事件'), owner: z.string().min(2, '请填写负责组') });

function SortableAction({ id, children }: { id: string; children: React.ReactNode }) {
  const sortable = useSortable({ id });
  return (
    <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="sortable-wrap">
      <button className="drag-handle" {...sortable.attributes} {...sortable.listeners} title="拖动排序"><GripVertical size={15} /></button>
      <div className="sortable-body">{children}</div>
    </div>
  );
}

export default function Page() {
  const t = useTranslations();
  const store = useIncidentStore();
  const incident = store.incident;
  const sensors = useSensors(useSensor(PointerSensor));
  const form = useForm<z.infer<typeof formSchema>>({ resolver: zodResolver(formSchema), defaultValues: { title: '', owner: '' } });
  const { data: health = { connected: false, latency: 0 } } = useQuery({
    queryKey: ['live', store.online],
    queryFn: async () => ({ connected: store.online && !store.forceOffline, latency: 42 }),
    refetchInterval: 10000
  });

  useEffect(() => { store.hydrate(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!store.demoMode && store.online && !store.forceOffline) store.tick(); }, 20000);
    return () => window.clearInterval(timer);
  }, [store.demoMode, store.online, store.forceOffline]);

  function dragEnd(event: DragEndEvent) { if (event.over) store.reorderActions(String(event.active.id), String(event.over.id)); }

  const canSeeSensitive = store.policy.rolePerms[store.role].seeSensitive;
  const conflictCount = incident.actions.reduce((n, a) => n + a.conflicts.length, 0);
  const pendingCount = store.outbox.length;
  const invalidCount = incident.actions.filter((a) => a.status === 'invalid').length;

  return <main className="shell">
    <header className="topbar">
      <div>
        <span className="eyebrow"><Radio size={14} /> LIVE WAR ROOM · PORT 62021</span>
        <h1>{t('title')}</h1>
        <p>{t('subtitle')}</p>
      </div>
      <div className="controls">
        <select value={store.role} onChange={(event) => store.setRole(event.target.value as typeof store.role)}>
          {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <Button variant={store.demoMode ? 'danger' : 'outline'} onClick={store.toggleDemo}><Eye size={16} />{store.demoMode ? '退出演示' : t('demo')}</Button>
      </div>
    </header>

    {store.demoMode && <div className="demo-banner">只读演示模式已开启：审批、执行、拖拽和新增操作均被冻结，仍可查看允许范围内的内容。</div>}
    {!store.demoMode && (!store.online || store.forceOffline) && (
      <div className="offline-banner"><WifiOff size={15} /> 离线模式：{pendingCount} 项操作已保存在本地待确认回执中，网络恢复后将按事件/动作标识自动合并，不会重复审批或执行。</div>
    )}
    {conflictCount > 0 && !store.demoMode && (
      <div className="conflict-banner"><ShieldAlert size={15} /> 有 {conflictCount} 个处置动作存在基于旧版本的冲突修改，两版均已保留，请在下方核对。</div>
    )}

    <section className="metrics">
      <Card><CardContent><span>当前事件</span><strong>{incident.id}</strong><Badge className="critical">{incident.severity}</Badge></CardContent></Card>
      <Card><CardContent><span>实时通道</span><strong>{health.connected ? `${health.latency}ms` : '离线'}</strong><small>{health.connected ? '协同通道已连接' : '等待网络恢复'}</small></CardContent></Card>
      <Card><CardContent><span>待确认回执</span><strong>{pendingCount}</strong><small>{conflictCount} 个冲突 · {invalidCount} 个已失效</small></CardContent></Card>
      <Card><CardContent><span>处置动作</span><strong>{incident.actions.filter((item) => item.status === 'executed').length}/{incident.actions.length}</strong><small>已执行/总数</small></CardContent></Card>
    </section>

    <section className="grid">
      <div className="stack">
        <Card>
          <CardHeader><div><h2>事件摘要</h2><p className="muted">影响范围：{incident.affected.join(' · ')}</p></div><ShieldAlert color="#ef4444" />
          </CardHeader>
          <CardContent>
            <div className="incident-state"><span>处置阶段</span><strong>{incident.status}</strong></div>
            <h3>子事件</h3>
            {incident.subIncidents.map((item) => <div className="sub-row" key={item.id}><div><strong>{item.title}</strong><div className="muted">{item.owner}</div></div><Badge>{item.status}</Badge></div>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><h2>{t('approval')}</h2><p className="muted">隔离动作需两名不同角色确认；权限或敏感级别变化后，不满足条件的待执行动作立即失效。</p></div><Users size={20} /></CardHeader>
          <CardContent>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
              <SortableContext items={incident.actions.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                <div>{incident.actions.map((action) => <SortableAction key={action.id} id={action.id}><ActionCard action={action} /></SortableAction>)}</div>
              </SortableContext>
            </DndContext>
          </CardContent>
        </Card>
      </div>

      <div className="stack">
        <Card>
          <CardHeader><h2>新增子事件</h2></CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit((values) => { store.addSubIncident(values); form.reset(); })}>
              <label>子事件名称<Input {...form.register('title')} placeholder="例如：凭据轮换" /></label>
              <small className="error">{form.formState.errors.title?.message}</small>
              <label>负责组<Input {...form.register('owner')} placeholder="例如：平台组" /></label>
              <small className="error">{form.formState.errors.owner?.message}</small>
              <Button type="submit" disabled={store.demoMode}><ShieldAlert size={16} />创建子事件</Button>
            </form>
          </CardContent>
        </Card>

        <OutboxPanel />
        <PolicyPanel />

        <Card className="timeline-card">
          <CardHeader><div><h2>{t('timeline')}</h2><p className="muted">按事件标识合并，保留全部历史记录</p></div>{health.connected ? <Wifi color="#10b981" /> : <WifiOff color="#ef4444" />}</CardHeader>
          <CardContent>
            <div className="timeline">{incident.timeline.map((event) => <article key={event.id}><i /><div><div className="timeline-meta"><strong>{event.actor}</strong><span>{formatDistanceToNow(new Date(event.at), { addSuffix: true, locale: zhCN })}</span></div><p>{event.sensitive && !canSeeSensitive ? '敏感处置记录已隐藏' : event.text}</p></div></article>)}</div>
          </CardContent>
        </Card>
      </div>
    </section>
  </main>;
}
