import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
const { createApp } = await import('../src/app.js');
const { creaUtente, hashPassword, verificaPassword, leggiRegistro, consentito } = await import('../src/auth.js');

const server = await new Promise((ok) => { const s = createApp({ auth: true }).listen(0, () => ok(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

async function chiama(percorso, { metodo = 'GET', body, cookie } = {}) {
  const r = await fetch(base + percorso, { method: metodo, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
}
const entra = async (username, password = 'password-lunga-1') => (await chiama('/api/auth/login', { metodo: 'POST', body: { username, password } }));

creaUtente({ username: 'admin1', nome: 'Amministratore', ruolo: 'admin', password: 'password-lunga-1' });
creaUtente({ username: 'tania', nome: 'Tania', ruolo: 'ufficio', password: 'password-lunga-1' });
creaUtente({ username: 'luca', nome: 'Luca', ruolo: 'magazzino', password: 'password-lunga-1' });

test('password: salvata cifrata e verificata; password corta rifiutata', () => {
  const h = hashPassword('segreta-123');
  assert.ok(!h.includes('segreta-123'));
  assert.ok(verificaPassword('segreta-123', h));
  assert.ok(!verificaPassword('altra', h));
  assert.throws(() => creaUtente({ username: 'x1x', ruolo: 'ufficio', password: 'corta' }), /almeno 8/);
});

test('senza accesso tutta l\'API risponde 401; credenziali sbagliate 401', async () => {
  assert.equal((await chiama('/api/info')).status, 401);
  assert.equal((await chiama('/api/ddt')).status, 401);
  assert.equal((await entra('tania', 'sbagliata')).status, 401);
  assert.equal((await entra('nessuno')).status, 401);
});

test('ruoli: ufficio lavora ma non vede utenti/registro; magazzino solo i fogli rilasciati; admin tutto', async () => {
  const t = (await entra('tania')).cookie;
  const l = (await entra('luca')).cookie;
  const a = (await entra('admin1')).cookie;
  assert.ok(t.startsWith('sid='));
  assert.equal((await chiama('/api/ddt', { cookie: t })).status, 200);
  assert.equal((await chiama('/api/utenti', { cookie: t })).status, 403);
  assert.equal((await chiama('/api/registro', { cookie: t })).status, 403);
  assert.equal((await chiama('/api/ddt', { cookie: l })).status, 403);
  assert.equal((await chiama('/api/utenti', { cookie: l })).status, 403);
  assert.equal((await chiama('/api/info', { cookie: l })).status, 200);
  assert.equal((await chiama('/api/utenti', { cookie: a })).status, 200);
  assert.ok(consentito('magazzino', 'GET', '/api/picking/rilasci'));
  assert.ok(consentito('magazzino', 'POST', '/api/picking/rilasci/stato'));
  assert.ok(!consentito('magazzino', 'POST', '/api/picking/ddt'));
  assert.ok(!consentito('magazzino', 'POST', '/api/picking/rilasci'));
});

test('registro: accessi e azioni che modificano, con utente; la password non compare mai', async () => {
  const t = (await entra('tania')).cookie;
  assert.equal((await chiama('/api/ddt/9999/scarta', { metodo: 'POST', cookie: t })).status, 404);
  const a = (await entra('admin1')).cookie;
  const r = (await chiama('/api/registro?utente=tania', { cookie: a })).json;
  assert.ok(r.righe.some((x) => x.azione === 'Accesso'));
  const scarto = r.righe.find((x) => /Scarta DDT in entrata #9999/.test(x.azione));
  assert.ok(scarto);
  assert.equal(scarto.esito, 'errore 404');
  assert.ok(leggiRegistro({ azione: 'Accesso negato' }).righe.length >= 2);
  assert.ok(!JSON.stringify(leggiRegistro({ limit: 500 }).righe).includes('password-lunga-1'));
});

test('utenti: crea da admin, disattiva (le sessioni cadono), cambio password propria', async () => {
  const a = (await entra('admin1')).cookie;
  assert.equal((await chiama('/api/utenti', { metodo: 'POST', cookie: a, body: { username: 'nuovo1', nome: 'Nuovo', ruolo: 'ufficio', password: 'password-lunga-1' } })).status, 200);
  assert.equal((await chiama('/api/utenti', { metodo: 'POST', cookie: a, body: { username: 'nuovo1', ruolo: 'ufficio', password: 'password-lunga-1' } })).status, 400);
  const n = await entra('nuovo1');
  assert.equal((await chiama('/api/ddt', { cookie: n.cookie })).status, 200);
  const id = (await chiama('/api/utenti', { cookie: a })).json.utenti.find((u) => u.username === 'nuovo1').id;
  assert.equal((await chiama(`/api/utenti/${id}/attivo`, { metodo: 'POST', cookie: a, body: { attivo: false } })).status, 200);
  assert.equal((await chiama('/api/ddt', { cookie: n.cookie })).status, 401);
  assert.equal((await entra('nuovo1')).status, 401);
  const t = (await entra('tania')).cookie;
  assert.equal((await chiama('/api/auth/password', { metodo: 'POST', cookie: t, body: { vecchia: 'errata-errata', nuova: 'nuova-password-2' } })).status, 403);
  assert.equal((await chiama('/api/auth/password', { metodo: 'POST', cookie: t, body: { vecchia: 'password-lunga-1', nuova: 'nuova-password-2' } })).status, 200);
  assert.equal((await entra('tania', 'password-lunga-1')).status, 401);
  assert.equal((await entra('tania', 'nuova-password-2')).status, 200);
});

test('non si disattiva l\'ultimo amministratore né se stessi; logout chiude la sessione', async () => {
  const a = (await entra('admin1')).cookie;
  const me = (await chiama('/api/auth/me', { cookie: a })).json.utente;
  assert.equal((await chiama(`/api/utenti/${me.id}/attivo`, { metodo: 'POST', cookie: a, body: { attivo: false } })).status, 400);
  assert.equal((await chiama(`/api/utenti/${me.id}/ruolo`, { metodo: 'POST', cookie: a, body: { ruolo: 'ufficio' } })).status, 400);
  await chiama('/api/auth/logout', { metodo: 'POST', cookie: a });
  assert.equal((await chiama('/api/auth/me', { cookie: a })).status, 401);
});

test('troppi tentativi sbagliati: blocco temporaneo', async () => {
  for (let i = 0; i < 5; i++) await entra('luca', `sbagliata-${i}`);
  assert.equal((await entra('luca')).status, 429);
});
