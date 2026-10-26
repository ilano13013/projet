/**
 * Stockage PRIVÉ sur disque à liens signés TEMPORAIRES (dev / staging).
 * Les fichiers ne sont jamais servis statiquement : seul un lien HMAC
 * (clé + expiration) vérifié par le serveur donne accès, pour une durée courte.
 * En production, remplacer par un bucket objet privé (même FileStoragePort).
 */
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { FileStoragePort } from '../ports';

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;   // pas de séparateur → pas de traversée de répertoire

function mac(key: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${key}.${exp}`).digest('hex');
}

export function signFileUrl(key: string, expSec: number, secret: string): string {
  return `/files/${encodeURIComponent(key)}?exp=${expSec}&sig=${mac(key, expSec, secret)}`;
}

export function verifyFileSig(key: string, exp: number, sig: string, secret: string, nowSec: number): boolean {
  if (!KEY_RE.test(key) || !Number.isInteger(exp) || !sig) return false;
  if (exp < nowSec) return false;                                  // lien expiré
  const a = Buffer.from(mac(key, exp, secret), 'utf8');
  const b = Buffer.from(sig, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class DiskPrivateStorage implements FileStoragePort {
  constructor(private root: string, private secret: string, private nowMs: () => number = Date.now) {}

  private file(key: string): string {
    if (!KEY_RE.test(key)) throw new Error('clé de stockage invalide');
    return path.join(this.root, key);
  }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.file(key), bytes, { mode: 0o600 });
  }
  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    return signFileUrl(key, Math.floor(this.nowMs() / 1000) + ttlSeconds, this.secret);
  }
  async remove(key: string): Promise<void> { await rm(this.file(key), { force: true }); }

  verify(key: string, exp: number, sig: string): boolean {
    return verifyFileSig(key, exp, sig, this.secret, Math.floor(this.nowMs() / 1000));
  }
  read(key: string): Promise<Buffer> { return readFile(this.file(key)); }
}
