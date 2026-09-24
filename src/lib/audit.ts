/**
 * Audit log helper — every mutation that touches money, member, stock, settings,
 * or system state MUST call logAction() inside the same transaction.
 *
 * Per Technical Review Section "Observability and audit":
 *   - actor, action, entity, entity ID, request ID, createdAt, result
 *   - Avoid logging full citizen IDs or slip images
 *
 * `tone` colors match the original Shop:
 *   blue (login/safety) · green (logout/license) · red (dev/restore/error)
 *   amber (warning) · purple (license/generate)
 */

import { db } from './db'

export type AuditTone = 'blue' | 'green' | 'red' | 'amber' | 'purple'

export interface AuditInput {
  action: string
  actorId?: string
  actor?: string // display name snapshot
  actorRole?: string
  actorIp?: string
  entity?: string
  entityId?: string
  detail: string
  tone?: AuditTone
  requestId?: string
}

export async function logAction(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actorId ?? null,
        actor: input.actor ?? null,
        actorRole: input.actorRole ?? null,
        actorIp: input.actorIp ?? null,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        detail: input.detail,
        tone: input.tone ?? 'blue',
        requestId: input.requestId ?? null,
      },
    })
  } catch (err) {
    // Audit log failure MUST NOT break the parent transaction.
    // Caller wraps in try/catch if they want to handle.
    console.error('[audit] logAction failed:', err)
  }
}

/** Same as logAction but inside an existing Prisma transaction. */
export function logActionTx(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], input: AuditInput): Promise<void> {
  return tx.auditLog.create({
    data: {
      action: input.action,
      actorId: input.actorId ?? null,
      actor: input.actor ?? null,
      actorRole: input.actorRole ?? null,
      actorIp: input.actorIp ?? null,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      detail: input.detail,
      tone: input.tone ?? 'blue',
      requestId: input.requestId ?? null,
    },
  }).then(() => undefined).catch(err => {
    console.error('[audit] logActionTx failed:', err)
  })
}
