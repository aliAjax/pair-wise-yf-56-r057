'use client';
import { FlaskConical, Wifi, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { KIND_LABELS, ROLE_LABELS, ROLE_ORDER } from '@/lib/collab/engine';
import type { Role } from '@/lib/collab/types';
import { useIncidentStore } from '@/lib/store';

export function PolicyPanel() {
  const policy = useIncidentStore((s) => s.policy);
  const incident = useIncidentStore((s) => s.incident);
  const demoMode = useIncidentStore((s) => s.demoMode);
  const simulateFailure = useIncidentStore((s) => s.simulateFailure);
  const forceOffline = useIncidentStore((s) => s.forceOffline);
  const setSimulateFailure = useIncidentStore((s) => s.setSimulateFailure);
  const setForceOffline = useIncidentStore((s) => s.setForceOffline);
  const changePerm = useIncidentStore((s) => s.changePerm);
  const editAction = useIncidentStore((s) => s.editAction);

  return (
    <Card>
      <CardHeader>
        <div><h2>权限与敏感级别</h2><p className="muted">变更后不满足条件的待执行动作立即失效，已执行结果保留</p></div>
        <FlaskConical size={18} />
      </CardHeader>
      <CardContent>
        <div className="perm-grid">
          {ROLE_ORDER.map((role: Role) => (
            <div key={role} className="perm-row">
              <strong>{ROLE_LABELS[role]}</strong>
              {(['approve', 'execute', 'seeSensitive'] as const).map((perm) => (
                <label key={perm} className="check">
                  <input type="checkbox" checked={policy.rolePerms[role][perm]} disabled={demoMode}
                    onChange={(e) => changePerm(role, { [perm]: e.target.checked })} />
                  {perm === 'approve' ? '审批' : perm === 'execute' ? '执行' : '敏感可见'}
                </label>
              ))}
            </div>
          ))}
        </div>

        <div className="sens-list">
          {incident.actions.map((a) => (
            <label key={a.id} className="check sens-row">
              <input type="checkbox" checked={a.sensitive} disabled={demoMode || a.status === 'executed'}
                onChange={(e) => editAction(a.id, { sensitive: e.target.checked })} />
              <span>{KIND_LABELS[a.kind]} · {a.title}</span>
            </label>
          ))}
        </div>

        <div className="demo-toggles">
          <label className="check"><input type="checkbox" checked={simulateFailure} onChange={(e) => setSimulateFailure(e.target.checked)} /> 模拟服务端故障（首次请求 500，重试成功）</label>
          <label className="check"><input type="checkbox" checked={forceOffline} onChange={(e) => setForceOffline(e.target.checked)} /> <WifiOff size={13} /> 模拟离线（操作入队，恢复后合并）</label>
          <div className="muted toggle-hint"><Wifi size={13} /> 真实网络状态：{typeof navigator !== 'undefined' && navigator.onLine ? '在线' : '离线'}</div>
        </div>
      </CardContent>
    </Card>
  );
}
