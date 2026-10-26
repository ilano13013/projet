/**
 * Routes HTTP du Lot 3 : messages de dossier, pièces, facturation, abonnement,
 * téléconsultation. Montées par buildApp() derrière les mêmes contrôles
 * (session → CSRF → autorisation par ressource → validation).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can } from '../domain/authz';
import { visibleMessages, canPost, notificationRecipients, type CaseCtx, type CaseMessage, type Delivery } from '../domain/messaging';
import { validateUpload, type UploadError } from '../domain/documents';
import { validateVisioUrl, DEFAULT_VISIO_HOSTS } from '../domain/visio';
import { effectiveTier, type SubState } from '../domain/entitlements';
import type { InvoiceRepoPort } from '../ports';
import type { Actor } from './services';

export interface Lot3Services {
  cases: { ctx(caseId: string): Promise<CaseCtx | null> };
  messages: {
    list(caseId: string): Promise<CaseMessage[]>;
    post(input: { caseId: string; senderUserId: string; body: string; internalNote: boolean; notifyUserIds: string[] }): Promise<{ id: string; deliveryStatus: Delivery }>;
  };
  documents: {
    ctxOf(docId: string): Promise<(CaseCtx & { caseId: string }) | null>;
    usage(ownerProId: string): Promise<{ usedBytes: number; limitBytes: number }>;
    create(input: { caseId: string; ownerUserId: string; ownerProId: string; safeName: string; mime: string; bytes: Uint8Array }): Promise<{ id: string }>;
    signedUrl(docId: string, ttlSeconds: number): Promise<string>;
    remove(docId: string): Promise<void>;
  };
  invoices: InvoiceRepoPort;
  subscriptions: { get(proId: string): Promise<SubState | null> };
  profile: { setTeleconsultUrl(proId: string, url: string | null): Promise<void> };
  /** Optionnel : service des fichiers signés (stockage disque dev/staging). */
  files?: { verify(key: string, exp: number, sig: string): boolean; read(key: string): Promise<Uint8Array> };
  visioAllowedHosts?: string[];
  now?: () => Date;
}

const DOWNLOAD_TTL_S = 300;
const UPLOAD_BODY_LIMIT = 15 * 1024 * 1024;   // 10 Mo max + surcoût base64

function uploadStatus(e: UploadError): number {
  return e === 'too_large' || e === 'quota_exceeded' ? 413 : 422;
}

export function registerLot3Routes(app: FastifyInstance, s: Lot3Services, requireActor: (req: FastifyRequest, reply: FastifyReply) => Actor | null): void {
  const now = s.now ?? (() => new Date());
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;
  const requirePro = (req: FastifyRequest, reply: FastifyReply): Actor | null => {
    const a = requireActor(req, reply); if (!a) return null;
    if (a.role !== 'professionnel') { reply.code(403).send({ error: 'forbidden' }); return null; }
    return a;
  };

  // ── Messages de dossier ──
  app.get('/cases/:id/messages', async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    const ctx = await s.cases.ctx(id(req));
    if (!ctx) return reply.code(404).send({ error: 'not_found' });
    if (!can(a, 'message:read', { ownerProId: ctx.ownerProId, participantUserIds: ctx.participantUserIds })) return reply.code(403).send({ error: 'forbidden' });
    return { messages: visibleMessages(await s.messages.list(id(req)), a, ctx) };
  });

  app.post('/cases/:id/messages', async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    const p = z.object({ body: z.string().trim().min(1).max(10_000), internalNote: z.boolean().optional() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid' });
    const ctx = await s.cases.ctx(id(req));
    if (!ctx) return reply.code(404).send({ error: 'not_found' });
    const internal = !!p.data.internalNote;
    if (!canPost(a, ctx, internal)) return reply.code(403).send({ error: 'forbidden' });
    const r = await s.messages.post({ caseId: id(req), senderUserId: a.userId, body: p.data.body, internalNote: internal,
      notifyUserIds: notificationRecipients(ctx, a.userId, internal) });
    return reply.code(201).send(r);
  });

  // ── Pièces ──
  app.post('/cases/:id/documents', { bodyLimit: UPLOAD_BODY_LIMIT }, async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    const p = z.object({ filename: z.string().min(1).max(255), mime: z.string().min(1).max(200), contentBase64: z.string().min(1) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid' });
    const ctx = await s.cases.ctx(id(req));
    if (!ctx) return reply.code(404).send({ error: 'not_found' });
    if (!can(a, 'document:upload', { ownerProId: ctx.ownerProId, participantUserIds: ctx.participantUserIds })) return reply.code(403).send({ error: 'forbidden' });
    const bytes = new Uint8Array(Buffer.from(p.data.contentBase64, 'base64'));
    const v = validateUpload({ filename: p.data.filename, mime: p.data.mime, bytes }, await s.documents.usage(ctx.ownerProId));
    if (!v.ok) return reply.code(uploadStatus(v.error)).send({ error: v.error });
    const doc = await s.documents.create({ caseId: id(req), ownerUserId: a.userId, ownerProId: ctx.ownerProId, safeName: v.safeName, mime: p.data.mime, bytes });
    return reply.code(201).send(doc);
  });

  app.get('/documents/:id/download', async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    const ctx = await s.documents.ctxOf(id(req));
    if (!ctx) return reply.code(404).send({ error: 'not_found' });
    if (!can(a, 'document:download', { ownerProId: ctx.ownerProId, participantUserIds: ctx.participantUserIds })) return reply.code(403).send({ error: 'forbidden' });
    return { url: await s.documents.signedUrl(id(req), DOWNLOAD_TTL_S), expiresInSeconds: DOWNLOAD_TTL_S };
  });

  app.delete('/documents/:id', async (req, reply) => {
    const a = requireActor(req, reply); if (!a) return;
    const ctx = await s.documents.ctxOf(id(req));
    if (!ctx) return reply.code(404).send({ error: 'not_found' });
    if (!can(a, 'document:delete', { ownerProId: ctx.ownerProId })) return reply.code(403).send({ error: 'forbidden' });
    await s.documents.remove(id(req));
    return { ok: true };
  });

  if (s.files) {
    const files = s.files;
    // Accès par lien signé temporaire uniquement (aucune session requise, aucun listing).
    app.get('/files/:key', async (req, reply) => {
      const key = (req.params as { key: string }).key;
      const q = req.query as { exp?: string; sig?: string };
      if (!files.verify(key, Number(q.exp), String(q.sig || ''))) return reply.code(403).send({ error: 'invalid_or_expired_link' });
      const data = await files.read(key);
      return reply.header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', 'attachment')
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(Buffer.from(data));
    });
  }

  // ── Facturation (honoraires — distincte de l'abonnement SaaS) ──
  app.post('/invoices', async (req, reply) => {
    const a = requirePro(req, reply); if (!a) return;
    const p = z.object({ amountCents: z.number().int(), clientUserId: z.string().optional(), caseId: z.string().optional(), service: z.string().max(500).optional() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid' });
    const r = await s.invoices.createDraft({ professionalUserId: a.userId, ...p.data });
    if (!r.ok) return reply.code(422).send({ error: r.reason });
    return reply.code(201).send({ id: r.id, status: 'draft' });
  });

  app.post('/invoices/:id/issue', async (req, reply) => {
    const a = requirePro(req, reply); if (!a) return;
    const r = await s.invoices.issue(id(req), a.userId, now().getUTCFullYear());
    if (!r.ok) return reply.code(r.reason === 'not_found' ? 404 : 409).send({ error: r.reason });
    return { number: r.number, status: 'issued' };
  });

  app.post('/invoices/:id/cancel', async (req, reply) => {
    const a = requirePro(req, reply); if (!a) return;
    const r = await s.invoices.cancel(id(req), a.userId);
    if (!r.ok) return reply.code(r.reason === 'not_found' ? 404 : 409).send({ error: r.reason });
    return { status: 'cancelled' };
  });

  app.delete('/invoices/:id', async (req, reply) => {
    const a = requirePro(req, reply); if (!a) return;
    const r = await s.invoices.deleteDraft(id(req), a.userId);
    if (!r.ok) return reply.code(r.reason === 'not_found' ? 404 : 409).send({ error: r.reason });
    return { ok: true };
  });

  // ── Abonnement : niveau effectif calculé côté serveur ──
  app.get('/subscription', async (req, reply) => {
    const a = requirePro(req, reply); if (!a) return;
    const st = await s.subscriptions.get(a.userId);
    return { tier: effectiveTier(st, now()), status: st?.status ?? 'none' };
  });

  // ── Téléconsultation : lien de fournisseur externe validé ──
  app.put('/pro/teleconsult-url', async (req, reply) => {
    const a = requirePro(req, reply); if (!a) return;
    const p = z.object({ url: z.string().max(2048).nullable() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'invalid' });
    if (p.data.url === null) { await s.profile.setTeleconsultUrl(a.userId, null); return { url: null }; }
    const v = validateVisioUrl(p.data.url, s.visioAllowedHosts ?? DEFAULT_VISIO_HOSTS);
    if (!v.ok) return reply.code(422).send({ error: v.error });
    await s.profile.setTeleconsultUrl(a.userId, v.url);
    return { url: v.url };
  });
}
