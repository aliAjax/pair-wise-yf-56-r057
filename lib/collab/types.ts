export type Role = 'analyst' | 'responder' | 'legal' | 'viewer';
export type Severity = 'medium' | 'high' | 'critical';
export type ActionKind = 'isolate' | 'block' | 'restore' | 'notify';
export type ActionStatus = 'pending' | 'approved' | 'executed' | 'invalid';
export type SubStatus = 'open' | 'contained' | 'closed';

export interface Approval { role: Role; at: string; op: string; }
export interface ConflictRecord { id: string; v: number; patch: Partial<Pick<ResponseAction, 'title' | 'kind' | 'sensitive'>>; by: Role; at: string; op: string; }
export interface ActionVersion { v: number; title: string; kind: ActionKind; sensitive: boolean; at: string; by: Role; op: string; }

export interface ResponseAction {
  id: string;
  v: number;
  title: string;
  kind: ActionKind;
  sensitive: boolean;
  approvals: Approval[];
  status: ActionStatus;
  order: number;
  history: ActionVersion[];
  conflicts: ConflictRecord[];
  executedAt?: string;
  executedBy?: Role;
  executeOp?: string;
}

export interface SubIncident { id: string; v: number; title: string; owner: string; status: SubStatus; }
export interface TimelineEvent { id: string; v: number; at: string; actor: string; text: string; sensitive?: boolean; }

export interface Incident {
  id: string;
  v: number;
  title: string;
  severity: Severity;
  status: 'investigating' | 'contained' | 'recovered';
  affected: string[];
  subIncidents: SubIncident[];
  actions: ResponseAction[];
  timeline: TimelineEvent[];
}

export interface RolePerms { approve: boolean; execute: boolean; seeSensitive: boolean; }
export interface Policy { v: number; rolePerms: Record<Role, RolePerms>; }

export type OpType = 'addSubIncident' | 'editAction' | 'approve' | 'execute' | 'reorder' | 'policyChange' | 'tick';

interface OpBase { id: string; type: OpType; at: string; by: Role | '系统'; baseV: number; }
export interface AddSubOp extends OpBase { type: 'addSubIncident'; by: Role; title: string; owner: string; }
export interface EditActionOp extends OpBase { type: 'editAction'; by: Role; entityId: string; patch: { title?: string; kind?: ActionKind; sensitive?: boolean }; }
export interface ApproveOp extends OpBase { type: 'approve'; by: Role; entityId: string; }
export interface ExecuteOp extends OpBase { type: 'execute'; by: Role; entityId: string; }
export interface ReorderOp extends OpBase { type: 'reorder'; by: Role; order: string[]; }
export interface PolicyOp extends OpBase { type: 'policyChange'; by: Role; role: Role; perms: Partial<RolePerms>; }
export interface TickOp extends OpBase { type: 'tick'; by: '系统'; }
export type Op = AddSubOp | EditActionOp | ApproveOp | ExecuteOp | ReorderOp | PolicyOp | TickOp;

export interface OpResult { ok: boolean; idempotent?: boolean; conflict?: ConflictRecord; error?: string; retryable?: boolean; }

export interface CollabState { incident: Incident; policy: Policy; appliedOps: string[]; }
