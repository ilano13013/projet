/**
 * Pièces jointes (Lot 3 / FUN-04).
 * Validation explicite AVANT stockage privé : taille, type déclaré, contenu réel
 * (signature binaire), nom de fichier assaini, quota. Chaque refus a un code
 * d'erreur visible — jamais de faux succès.
 * Le stockage n'est PAS un « coffre-fort probatoire » : aucune valeur probante
 * n'est revendiquée.
 */

export const MAX_DOC_BYTES = 10 * 1024 * 1024;           // 10 Mo par fichier
export const DEFAULT_QUOTA_BYTES = 200 * 1024 * 1024;    // 200 Mo par professionnel

export const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type UploadError = 'empty' | 'too_large' | 'type_not_allowed' | 'content_mismatch' | 'bad_name' | 'quota_exceeded';

/** Retire chemins, caractères de contrôle et séparateurs ; borne la longueur. */
export function sanitizeFilename(name: string): string {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  return cleaned.slice(0, 120);
}

/** Type réel déduit des premiers octets (null si non reconnaissable). */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';   // %PDF
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'application/zip'; // docx = zip
  return null;
}

function contentMatches(declared: string, bytes: Uint8Array): boolean {
  const sniffed = sniffMime(bytes);
  if (declared === 'text/plain') {
    // texte : pas de signature binaire connue et pas d'octet nul
    return sniffed === null && !bytes.includes(0);
  }
  if (declared === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return sniffed === 'application/zip';
  return sniffed === declared;
}

export function validateUpload(
  input: { filename: string; mime: string; bytes: Uint8Array },
  quota: { usedBytes: number; limitBytes: number },
): { ok: true; safeName: string } | { ok: false; error: UploadError } {
  const size = input.bytes.length;
  if (size === 0) return { ok: false, error: 'empty' };
  if (size > MAX_DOC_BYTES) return { ok: false, error: 'too_large' };
  if (!(ALLOWED_MIME as readonly string[]).includes(input.mime)) return { ok: false, error: 'type_not_allowed' };
  if (!contentMatches(input.mime, input.bytes)) return { ok: false, error: 'content_mismatch' };
  const safeName = sanitizeFilename(input.filename);
  if (!safeName) return { ok: false, error: 'bad_name' };
  if (quota.usedBytes + size > quota.limitBytes) return { ok: false, error: 'quota_exceeded' };
  return { ok: true, safeName };
}
