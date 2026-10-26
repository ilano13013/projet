/**
 * Messagerie de dossier (Lot 3 / FUN-03).
 * - Un message est soit une NOTE INTERNE (visible du seul pro propriétaire),
 *   soit un MESSAGE TRANSMIS (visible de tous les participants autorisés).
 * - Statut de livraison explicite : stored → delivered | failed.
 * - La notification email ne contient JAMAIS le contenu juridique.
 */
import { can, type Actor } from './authz';

export type Delivery = 'stored' | 'delivered' | 'failed';

export interface CaseMessage {
  id: string;
  senderUserId: string;
  body: string;
  internalNote: boolean;
  deliveryStatus: Delivery;
  createdAt: Date;
}

export interface CaseCtx { ownerProId: string; participantUserIds: string[]; }

/** Messages visibles par `viewer` dans un dossier (refus par défaut). */
export function visibleMessages(msgs: CaseMessage[], viewer: Actor | null, ctx: CaseCtx): CaseMessage[] {
  if (!can(viewer, 'message:read', { ownerProId: ctx.ownerProId, participantUserIds: ctx.participantUserIds })) return [];
  const isOwner = !!viewer && viewer.role === 'professionnel' && viewer.userId === ctx.ownerProId;
  return msgs.filter(m => !m.internalNote || isOwner);
}

/** Seul le pro propriétaire peut écrire une note interne. */
export function canPost(actor: Actor | null, ctx: CaseCtx, internalNote: boolean): boolean {
  if (!can(actor, 'message:write', { ownerProId: ctx.ownerProId, participantUserIds: ctx.participantUserIds })) return false;
  if (internalNote) return !!actor && actor.role === 'professionnel' && actor.userId === ctx.ownerProId;
  return true;
}

/** Destinataires à notifier : participants hors expéditeur ; aucun pour une note interne. */
export function notificationRecipients(ctx: CaseCtx, senderUserId: string, internalNote: boolean): string[] {
  if (internalNote) return [];
  const all = new Set([ctx.ownerProId, ...ctx.participantUserIds]);
  all.delete(senderUserId);
  return [...all];
}

/** Notification générique — volontairement SANS le contenu du message. */
export function notificationEmail(): { subject: string; body: string } {
  return {
    subject: 'PRIMA — nouveau message',
    body: 'Un nouveau message vous attend dans votre espace PRIMA. '
      + 'Pour des raisons de confidentialité, son contenu n\'est pas reproduit dans cet email.',
  };
}
