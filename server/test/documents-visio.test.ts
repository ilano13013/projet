import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUpload, sanitizeFilename, sniffMime, MAX_DOC_BYTES } from '../src/domain/documents';
import { validateVisioUrl } from '../src/domain/visio';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);   // %PDF-1.7
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const QUOTA = { usedBytes: 0, limitBytes: 1024 * 1024 };

test('pièce : PDF valide accepté, nom assaini', () => {
  const r = validateUpload({ filename: '../../etc/contrat.pdf', mime: 'application/pdf', bytes: PDF }, QUOTA);
  assert.deepEqual(r, { ok: true, safeName: 'contrat.pdf' });
});

test('pièce : contenu ne correspondant pas au type déclaré → refus', () => {
  const r = validateUpload({ filename: 'faux.pdf', mime: 'application/pdf', bytes: PNG }, QUOTA);
  assert.deepEqual(r, { ok: false, error: 'content_mismatch' });
});

test('pièce : type non autorisé, vide, trop volumineuse', () => {
  assert.deepEqual(validateUpload({ filename: 'x.exe', mime: 'application/x-msdownload', bytes: PDF }, QUOTA), { ok: false, error: 'type_not_allowed' });
  assert.deepEqual(validateUpload({ filename: 'x.pdf', mime: 'application/pdf', bytes: new Uint8Array() }, QUOTA), { ok: false, error: 'empty' });
  const big = new Uint8Array(MAX_DOC_BYTES + 1); big.set(PDF);
  assert.deepEqual(validateUpload({ filename: 'x.pdf', mime: 'application/pdf', bytes: big }, { usedBytes: 0, limitBytes: 1e12 }), { ok: false, error: 'too_large' });
});

test('pièce : quota dépassé → erreur explicite (pas de faux succès)', () => {
  const r = validateUpload({ filename: 'c.pdf', mime: 'application/pdf', bytes: PDF }, { usedBytes: 1024 * 1024 - 2, limitBytes: 1024 * 1024 });
  assert.deepEqual(r, { ok: false, error: 'quota_exceeded' });
});

test('pièce : texte refusé s’il contient un octet nul ; nom vide refusé', () => {
  assert.deepEqual(validateUpload({ filename: 'n.txt', mime: 'text/plain', bytes: new Uint8Array([0x41, 0x00]) }, QUOTA), { ok: false, error: 'content_mismatch' });
  assert.deepEqual(validateUpload({ filename: '/../', mime: 'application/pdf', bytes: PDF }, QUOTA), { ok: false, error: 'bad_name' });
  assert.equal(sanitizeFilename('a<b>:"c|?.pdf'), 'abc.pdf');
  assert.equal(sniffMime(PDF), 'application/pdf');
});

test('visio : https vers fournisseur autorisé accepté', () => {
  assert.deepEqual(validateVisioUrl('https://meet.jit.si/prima-salle-42'), { ok: true, url: 'https://meet.jit.si/prima-salle-42' });
  assert.ok(validateVisioUrl('https://cabinet.zoom.us/j/123').ok);
});

test('visio : javascript:, http, identifiants intégrés, hôte inconnu → refus', () => {
  assert.deepEqual(validateVisioUrl('javascript:alert(1)'), { ok: false, error: 'scheme_not_allowed' });
  assert.deepEqual(validateVisioUrl('http://meet.jit.si/x'), { ok: false, error: 'scheme_not_allowed' });
  assert.deepEqual(validateVisioUrl('https://user:pw@meet.jit.si/x'), { ok: false, error: 'credentials_not_allowed' });
  assert.deepEqual(validateVisioUrl('https://meet.jit.si.evil.example/x'), { ok: false, error: 'host_not_allowed' });
  assert.deepEqual(validateVisioUrl('pas une url'), { ok: false, error: 'invalid_url' });
});
