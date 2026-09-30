'use client';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, Send, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useIncidentStore } from '@/lib/store';

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-CN');
}

export function OutboxPanel() {
  const outbox = useIncidentStore((s) => s.outbox);
  const receipts = useIncidentStore((s) => s.receipts);
  const online = useIncidentStore((s) => s.online);
  const forceOffline = useIncidentStore((s) => s.forceOffline);
  const retryOp = useIncidentStore((s) => s.retryOp);
  const dismissOp = useIncidentStore((s) => s.dismissOp);
  const clearReceipt = useIncidentStore((s) => s.clearReceipt);

  const pending = outbox.filter((i) => i.status === 'pending');
  const failed = outbox.filter((i) => i.status === 'failed');
  const conflicts = outbox.filter((i) => i.status === 'conflict');

  return (
    <Card>
      <CardHeader>
        <div>
          <h2>待确认回执</h2>
          <p className="muted">操作按事件/动作标识合并，重试幂等，不会重复审批或重复执行</p>
        </div>
        {(!online || forceOffline) ? <Badge className="badge-offline"><CloudOff size={12} /> 离线</Badge> : <Send size={18} />}
      </CardHeader>
      <CardContent>
        {outbox.length === 0 && <p className="muted">所有操作均已确认，无待回执事项。</p>}

        {pending.map((item) => (
          <div key={item.op.id} className="receipt-row">
            <RefreshCw size={14} className="spin" />
            <div><strong>推送中</strong><div className="muted">{item.op.type} · 第 {item.attempts} 次尝试 · {fmt(item.op.at)}</div></div>
          </div>
        ))}

        {failed.map((item) => (
          <div key={item.op.id} className="receipt-row is-failed">
            <AlertTriangle size={14} />
            <div className="receipt-body">
              <strong>失败待确认</strong>
              <div className="muted">{item.lastError} · 第 {item.attempts} 次尝试 · {fmt(item.op.at)}</div>
              <div className="row-actions">
                <Button size="sm" variant="outline" onClick={() => retryOp(item.op.id)}><RefreshCw size={13} />重试</Button>
                <Button size="sm" variant="ghost" onClick={() => dismissOp(item.op.id)}>放弃</Button>
              </div>
            </div>
          </div>
        ))}

        {conflicts.map((item) => (
          <div key={item.op.id} className="receipt-row is-conflict">
            <XCircle size={14} />
            <div className="receipt-body">
              <strong>版本冲突</strong>
              <div className="muted">服务端已存在更新版本，冲突内容已保留为两版 · {fmt(item.op.at)}</div>
              <div className="row-actions"><Button size="sm" variant="ghost" onClick={() => dismissOp(item.op.id)}>知道了</Button></div>
            </div>
          </div>
        ))}

        {receipts.length > 0 && (
          <div className="receipt-history">
            <div className="muted receipt-history-head">最近回执
              <button className="link-btn" onClick={() => receipts.forEach((r) => clearReceipt(r.id))}>清空</button>
            </div>
            {receipts.slice(0, 8).map((r) => (
              <div key={r.id} className="receipt-line">
                {r.status === 'acked' ? <CheckCircle2 size={13} className="ok" /> : r.status === 'conflict' ? <XCircle size={13} className="warn" /> : <AlertTriangle size={13} className="warn" />}
                <span>{r.summary}</span>
                <span className="muted">{fmt(r.at)}</span>
                <Badge className={r.status === 'acked' ? 'badge-executed' : r.status === 'conflict' ? 'badge-invalid' : 'badge-pending'}>
                  {r.status === 'acked' ? '已确认' : r.status === 'conflict' ? '冲突' : r.status === 'failed' ? '失败' : '待确认'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
