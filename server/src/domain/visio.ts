/**
 * Téléconsultation (Lot 3) — PRIMA n'implémente PAS de visio native.
 * Le professionnel renseigne le lien d'un fournisseur externe ; on n'accepte
 * qu'une URL https://, sans identifiants intégrés, vers un hôte autorisé
 * (liste blanche configurable : VISIO_ALLOWED_HOSTS).
 */

export const DEFAULT_VISIO_HOSTS = ['meet.jit.si', 'whereby.com', 'zoom.us', 'teams.microsoft.com', 'meet.google.com'];

export type VisioError = 'invalid_url' | 'scheme_not_allowed' | 'credentials_not_allowed' | 'host_not_allowed';

export function validateVisioUrl(raw: string, allowedHosts: readonly string[] = DEFAULT_VISIO_HOSTS):
  { ok: true; url: string } | { ok: false; error: VisioError } {
  let u: URL;
  try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, error: 'invalid_url' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'scheme_not_allowed' };
  if (u.username || u.password) return { ok: false, error: 'credentials_not_allowed' };
  const host = u.hostname.toLowerCase();
  const allowed = allowedHosts.some(h => host === h || host.endsWith('.' + h));
  if (!allowed) return { ok: false, error: 'host_not_allowed' };
  return { ok: true, url: u.href };
}
