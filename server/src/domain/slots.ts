/**
 * Calcul des créneaux réservables (FUN-01).
 * Pur et déterministe : prend des règles d'horaires, des périodes bloquées et
 * les rendez-vous actifs, et produit des instants UTC réservables.
 * Gère le fuseau (Europe/Paris par défaut) et les changements d'heure (DST).
 */

export interface AvailabilityRule {
  weekday: number;      // 0 = lundi … 6 = dimanche
  startMinute: number;  // minutes depuis minuit (heure locale du fuseau)
  endMinute: number;
  timezone: string;     // ex. 'Europe/Paris'
  active?: boolean;
}

export interface Interval { startUtc: Date; endUtc: Date; }

export interface SlotParams {
  dateISO: string;                 // 'YYYY-MM-DD' (jour calendaire à ouvrir)
  rules: AvailabilityRule[];
  blocked: Interval[];             // périodes bloquées (UTC)
  existing: Interval[];            // RDV actifs existants (UTC)
  durationMinutes: number;         // durée du type de RDV
  stepMinutes?: number;            // granularité des créneaux (défaut : durée)
  timezone?: string;               // défaut : 'Europe/Paris'
  nowUtc: Date;                    // instant courant (exclut le passé)
}

/** Décalage (minutes) local - UTC pour un fuseau à un instant donné. */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - instant.getTime()) / 60000;
}

/** Convertit une heure murale (dans `tz`) en instant UTC, robuste au DST. */
export function zonedWallTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMinutes(new Date(guess), tz);
  let utc = guess - off * 60000;
  off = tzOffsetMinutes(new Date(utc), tz);   // seconde passe : corrige aux bascules DST
  utc = guess - off * 60000;
  return new Date(utc);
}

/** Jour de la semaine 0=lundi … 6=dimanche pour une date calendaire. */
export function weekdayMondayZero(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Retourne les débuts de créneaux réservables (UTC, triés). */
export function computeSlots(params: SlotParams): Date[] {
  const tz = params.timezone || 'Europe/Paris';
  const step = params.stepMinutes && params.stepMinutes > 0 ? params.stepMinutes : params.durationMinutes;
  const dur = params.durationMinutes;
  if (!(dur > 0) || !(step > 0)) return [];
  const [y, m, d] = params.dateISO.split('-').map(Number);
  const wd = weekdayMondayZero(params.dateISO);
  const now = params.nowUtc.getTime();

  const blocked = params.blocked.map(b => [b.startUtc.getTime(), b.endUtc.getTime()] as const);
  const taken = params.existing.map(e => [e.startUtc.getTime(), e.endUtc.getTime()] as const);

  const out: Date[] = [];
  const seen = new Set<number>();
  for (const rule of params.rules) {
    if (rule.active === false) continue;
    if (rule.weekday !== wd) continue;
    const ruleTz = rule.timezone || tz;
    for (let startMin = rule.startMinute; startMin + dur <= rule.endMinute; startMin += step) {
      const hh = Math.floor(startMin / 60), mm = startMin % 60;
      const startUtc = zonedWallTimeToUtc(y, m, d, hh, mm, ruleTz).getTime();
      const endUtc = startUtc + dur * 60000;
      if (startUtc < now) continue;                                   // passé
      if (blocked.some(([bs, be]) => overlaps(startUtc, endUtc, bs, be))) continue;
      if (taken.some(([ts, te]) => overlaps(startUtc, endUtc, ts, te))) continue;
      if (seen.has(startUtc)) continue;
      seen.add(startUtc);
      out.push(new Date(startUtc));
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}
