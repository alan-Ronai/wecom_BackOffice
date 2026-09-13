import type { Tx } from './sql.js';
export interface AuditInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  ip: string | null;
}
export async function audit(tx: Tx, a: AuditInput): Promise<string> {
  const r = await tx.query(
    'insert into audit_log(actor_id, action, entity_type, entity_id, before, after, request_id, ip) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
    [
      a.actorId,
      a.action,
      a.entityType,
      a.entityId,
      a.before === undefined ? null : JSON.stringify(a.before),
      a.after === undefined ? null : JSON.stringify(a.after),
      a.requestId,
      a.ip,
    ],
  );
  return r.rows[0].id as string;
}
