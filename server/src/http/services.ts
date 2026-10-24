/**
 * Frontière de services pour la couche HTTP. Les routes restent minces et
 * testables : on injecte des implémentations réelles (adaptateurs Postgres/
 * Stripe/stockage) en production, ou des doublures en test (fastify.inject).
 */
import type { Role } from '../domain/authz';
import type { BookingResult } from '../ports';

export interface Actor { userId: string; role: Role; mfa?: boolean; }

export interface SessionService {
  actorForSession(sid: string | undefined): Promise<Actor | null>;
}

export interface AuthService {
  register(input: { email: string; password: string; role: Role }): Promise<{ sessionId: string } | { error: string }>;
  login(email: string, password: string): Promise<{ sessionId: string } | null>;
  logout(sid: string): Promise<void>;
  /** SEC-02 : réponse uniforme, aucune fuite d'existence de compte. */
  requestReset(email: string): Promise<void>;
  confirmReset(token: string, newPassword: string): Promise<boolean>;
}

export interface SlotsService {
  forPro(proId: string, dateISO: string): Promise<string[]>; // ISO UTC
}

export interface AppointmentService {
  book(actor: Actor, proId: string, startUtc: Date, endUtc: Date, motif?: string): Promise<BookingResult>;
  ownerOf(appointmentId: string): Promise<string | null>;
  setStatus(appointmentId: string, status: 'confirmed' | 'cancelled'): Promise<void>;
}

export interface VerificationService {
  decide(adminId: string, proId: string, decision: 'approved' | 'rejected', note?: string): Promise<void>;
}

export interface BillingService {
  checkout(proId: string, plan: string): Promise<{ url: string }>;
}

export interface WebhookService {
  /** Vérifie la signature + idempotence, calcule les droits côté serveur. */
  handleStripe(payload: string, signature: string): Promise<{ status: number }>;
}

export interface Services {
  session: SessionService;
  auth: AuthService;
  slots: SlotsService;
  appts: AppointmentService;
  verification: VerificationService;
  billing: BillingService;
  webhook: WebhookService;
}
