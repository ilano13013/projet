/**
 * Facturation — règles pures (FUN-06).
 * Numérotation durable et monotone, séparation brouillon/émise, validation des
 * montants. La numérotation ATOMIQUE réelle est garantie côté base
 * (table invoice_sequences + transaction) ; ici on fournit la logique pure.
 */

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

/** Montant en CENTIMES : entier strictement positif. */
export function isValidAmountCents(cents: unknown): boolean {
  return typeof cents === 'number' && Number.isInteger(cents) && cents > 0;
}

/** Numéro à l'émission, à partir du dernier seq (jamais réutilisé). */
export function nextInvoiceNumber(lastSeq: number, year: number): { seq: number; number: string } {
  const seq = (Number.isInteger(lastSeq) && lastSeq >= 0 ? lastSeq : 0) + 1;
  return { seq, number: `F-${year}-${String(seq).padStart(6, '0')}` };
}

/** Une facture émise/payée ne peut pas être supprimée (corrections via annulation). */
export function canDelete(status: InvoiceStatus): boolean {
  return status === 'draft';
}

/** Transitions autorisées. */
export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  const allowed: Record<InvoiceStatus, InvoiceStatus[]> = {
    draft: ['issued', 'cancelled'],
    issued: ['paid', 'cancelled'],
    paid: ['cancelled'],      // correction = avoir/annulation, jamais suppression
    cancelled: [],
  };
  return (allowed[from] || []).includes(to);
}

/** Le numéro n'est attribué qu'à l'émission (brouillon = pas de numéro). */
export function shouldAssignNumber(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return from === 'draft' && to === 'issued';
}
