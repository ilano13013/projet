/**
 * Autorisation — REFUS PAR DÉFAUT (Lot 1).
 * Décisions pures et explicites, testées en croisé (cabinet A/B, particulier A/B).
 * Le masquage d'UI n'est JAMAIS une autorisation : toute lecture/écriture/
 * téléchargement passe par `can()` côté serveur.
 */

export type Role = 'particulier' | 'professionnel' | 'admin';

export interface Actor {
  userId: string;
  role: Role;
}

export type Action =
  | 'case:read' | 'case:write'
  | 'appointment:read' | 'appointment:write'
  | 'invoice:read' | 'invoice:write'
  | 'document:read' | 'document:download' | 'document:delete'
  | 'message:read' | 'message:write'
  | 'verification:decide'
  | 'subscription:read';

export interface ResourceCtx {
  /** Propriétaire professionnel de la ressource, si applicable. */
  ownerProId?: string;
  /** Client rattaché, si applicable. */
  clientUserId?: string;
  /** Participants autorisés (dossier), si applicable. */
  participantUserIds?: string[];
}

/** Décision unique : true seulement si une règle explicite l'autorise. */
export function can(actor: Actor | null | undefined, action: Action, res: ResourceCtx = {}): boolean {
  if (!actor || !actor.userId) return false;           // non authentifié → refus

  // L'admin ne décide QUE de la vérification (pas d'accès au contenu des affaires).
  if (action === 'verification:decide') return actor.role === 'admin';
  if (actor.role === 'admin') return false;            // refus par défaut pour le reste

  const isOwnerPro = !!res.ownerProId && res.ownerProId === actor.userId && actor.role === 'professionnel';
  const isClient = !!res.clientUserId && res.clientUserId === actor.userId;
  const isParticipant = Array.isArray(res.participantUserIds) && res.participantUserIds.includes(actor.userId);

  switch (action) {
    case 'case:read':
    case 'appointment:read':
    case 'invoice:read':
    case 'subscription:read':
      return isOwnerPro || isClient;
    case 'case:write':
    case 'appointment:write':
    case 'invoice:write':
      return isOwnerPro;
    case 'message:read':
    case 'document:read':
    case 'document:download':
      return isOwnerPro || isParticipant || isClient;
    case 'message:write':
      return isOwnerPro || isParticipant;
    case 'document:delete':
      return isOwnerPro;                               // seul le pro propriétaire supprime
    default:
      return false;                                    // refus par défaut
  }
}
