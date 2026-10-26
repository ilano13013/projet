import type { SubState } from '../domain/entitlements';

/**
 * Ports (interfaces) — frontières testables. Les implémentations concrètes
 * (PostgreSQL, stockage privé, email, Stripe) sont injectées. Aucune dépendance
 * externe ici, pour garder le cœur testable et remplaçable.
 */

export interface FileStoragePort {
  /** Dépose un objet en stockage PRIVÉ et renvoie sa clé. */
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** URL signée TEMPORAIRE pour un accès autorisé ponctuel. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  remove(key: string): Promise<void>;
}

export interface EmailJob {
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;   // évite les doublons lors des reprises
}

export interface EmailQueuePort {
  /** Met en file (traitement serveur avec reprises + statut de livraison). */
  enqueue(job: EmailJob): Promise<void>;
}

export interface CheckoutSession { url: string; providerSessionId: string; }

export interface PaymentPort {
  /** Crée une session de paiement SERVEUR (abonnement SaaS, mode test). */
  createCheckout(input: { plan: string; customerRef: string; successUrl: string; cancelUrl: string }): Promise<CheckoutSession>;
  /** Vérifie la signature d'un webhook entrant. */
  verifyWebhook(payload: string, signature: string): boolean;
}

export interface AuditEvent {
  actorUserId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;   // JAMAIS de contenu sensible / secret / pièce
}

export interface AuditPort {
  record(ev: AuditEvent): Promise<void>;
}

/** Résultat d'une tentative de réservation transactionnelle. */
export type BookingResult = { ok: true; appointmentId: string } | { ok: false; reason: 'slot_taken' | 'not_bookable' };

export interface AppointmentRepoPort {
  /**
   * Réserve un créneau DANS UNE TRANSACTION. La contrainte base
   * ux_appt_active_slot garantit qu'aucune double réservation active n'existe :
   * deux appels concurrents sur le même créneau → un seul réussit.
   */
  bookTransactional(input: {
    professionalUserId: string;
    clientUserId?: string;
    appointmentTypeId?: string;
    startUtc: Date;
    endUtc: Date;
    motif?: string;
  }): Promise<BookingResult>;
}

/* ───────────── Lot 3 : facturation & abonnement ───────────── */

export type DraftResult = { ok: true; id: string } | { ok: false; reason: 'invalid_amount' };
export type IssueResult = { ok: true; seq: number; number: string } | { ok: false; reason: 'not_found' | 'not_draft' };
export type InvoiceOpResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_draft' | 'invalid_transition' };

export interface InvoiceRepoPort {
  /** Brouillon : pas de numéro. Montant en centimes strictement positif. */
  createDraft(input: { professionalUserId: string; clientUserId?: string; caseId?: string; amountCents: number; service?: string }): Promise<DraftResult>;
  /** Émission : attribue un numéro DURABLE et ATOMIQUE (jamais réutilisé). */
  issue(invoiceId: string, professionalUserId: string, year: number): Promise<IssueResult>;
  /** Annulation (correction) : jamais de suppression d'une facture émise. */
  cancel(invoiceId: string, professionalUserId: string): Promise<InvoiceOpResult>;
  /** Seul un brouillon peut être supprimé. */
  deleteDraft(invoiceId: string, professionalUserId: string): Promise<InvoiceOpResult>;
}

export interface SubscriptionRepoPort {
  get(professionalUserId: string): Promise<SubState | null>;
  save(professionalUserId: string, state: SubState): Promise<void>;
}
