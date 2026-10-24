/**
 * Adaptateur PostgreSQL (production). Non exécuté dans l'environnement de
 * scaffold (pas de serveur Postgres) ; type-vérifié. Même motif transactionnel
 * que l'index unique partiel ux_appt_active_slot → anti-double-réservation.
 */
import type { Pool, PoolClient } from 'pg';
import type { AppointmentRepoPort, BookingResult } from '../ports';

const UNIQUE_VIOLATION = '23505';

export class PgAppointmentRepo implements AppointmentRepoPort {
  constructor(private pool: Pool) {}

  async bookTransactional(input: {
    professionalUserId: string; clientUserId?: string; appointmentTypeId?: string;
    startUtc: Date; endUtc: Date; motif?: string;
  }): Promise<BookingResult> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{ id: string }>(
        `INSERT INTO appointments
           (professional_user_id, client_user_id, appointment_type_id, start_at, end_at, status, motif)
         VALUES ($1,$2,$3,$4,$5,'pending',$6)
         RETURNING id`,
        [input.professionalUserId, input.clientUserId ?? null, input.appointmentTypeId ?? null,
         input.startUtc, input.endUtc, input.motif ?? null],
      );
      await client.query('COMMIT');
      return { ok: true, appointmentId: res.rows[0].id };
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string })?.code === UNIQUE_VIOLATION) return { ok: false, reason: 'slot_taken' };
      throw e;
    } finally {
      client.release();
    }
  }
}
