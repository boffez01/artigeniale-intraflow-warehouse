// Accesso con utente e password, ruoli e registro delle attività.
//  - password mai salvate in chiaro: scrypt con sale casuale
//  - sessione = cookie HttpOnly con un codice casuale; sul DB resta solo il suo hash (un furto del DB non dà accessi)
//  - ruoli: admin (tutto + utenti e registro) | ufficio (tutto tranne utenti e registro) | magazzino (solo la pagina Magazzino)
//  - registro: ogni azione che modifica qualcosa (POST/PUT/DELETE) e ogni accesso, con utente, data e ora, e cosa è successo
import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { handle as db } from './db.js';

export const RUOLI = ['admin', 'ufficio', 'magazzino'];

db.exec(`
CREATE TABLE IF NOT EXISTS utenti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome TEXT NOT NULL,
  ruolo TEXT NOT NULL,
  hash TEXT NOT NULL,
  attivo INTEGER NOT NULL DEFAULT 1,
  creato TEXT NOT NULL,
  ultimo_accesso TEXT
);
CREATE TABLE IF NOT EXISTS sessioni (
  token_hash TEXT PRIMARY KEY,
  utente_id INTEGER NOT NULL,
  creata TEXT NOT NULL,
  scade TEXT NOT NULL,
  ip TEXT,
  agente TEXT
);
CREATE TABLE IF NOT EXISTS registro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quando TEXT NOT NULL,
  utente_id INTEGER,
  username TEXT,
  azione TEXT NOT NULL,
  dettaglio TEXT,
  esito TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS ix_registro_quando ON registro(quando);
CREATE INDEX IF NOT EXISTS ix_registro_utente ON registro(username);`);

const ora = () => new Date().toISOString();
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ---------- password
const SCRYPT = { N: 16384, r: 8, p: 1 };
export function hashPassword(password) {
  const sale = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(password), sale, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${sale.toString('hex')}$${h.toString('hex')}`;
}
export function verificaPassword(password, salvato) {
  const [tipo, n, sale, h] = String(salvato ?? '').split('$');
  if (tipo !== 'scrypt' || !sale || !h) return false;
  const calcolato = crypto.scryptSync(String(password), Buffer.from(sale, 'hex'), 64, { ...SCRYPT, N: Number(n) });
  const atteso = Buffer.from(h, 'hex');
  return calcolato.length === atteso.length && crypto.timingSafeEqual(calcolato, atteso);
}
const HASH_FINTO = hashPassword('non-esiste'); // per non far capire dai tempi se l'utente esiste
export const controllaPassword = (p) => {
  if (typeof p !== 'string' || p.length < 8) throw new Error('La password deve avere almeno 8 caratteri');
  if (p.length > 200) throw new Error('Password troppo lunga');
};

// ---------- utenti
const pubblico = (u) => (u ? { id: u.id, username: u.username, nome: u.nome, ruolo: u.ruolo, attivo: !!u.attivo, creato: u.creato, ultimo_accesso: u.ultimo_accesso } : null);
export const elencoUtenti = () => db.prepare('SELECT * FROM utenti ORDER BY username').all().map(pubblico);
const perUsername = (username) => db.prepare('SELECT * FROM utenti WHERE username = ?').get(String(username ?? '').trim());
const perId = (id) => db.prepare('SELECT * FROM utenti WHERE id = ?').get(Number(id));

export function creaUtente({ username, nome, ruolo, password }) {
  username = String(username ?? '').trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error('Nome utente: da 3 a 40 caratteri, solo lettere, numeri, punto, trattino');
  if (!RUOLI.includes(ruolo)) throw new Error(`Ruolo non valido (${RUOLI.join(', ')})`);
  controllaPassword(password);
  if (perUsername(username)) throw new Error('Esiste già un utente con questo nome');
  const r = db.prepare('INSERT INTO utenti(username,nome,ruolo,hash,creato) VALUES (?,?,?,?,?)').run(username, String(nome || username).trim().slice(0, 80), ruolo, hashPassword(password), ora());
  return pubblico(perId(r.lastInsertRowid));
}
export function cambiaPassword(id, password) {
  controllaPassword(password);
  db.prepare('UPDATE utenti SET hash = ? WHERE id = ?').run(hashPassword(password), Number(id));
  db.prepare('DELETE FROM sessioni WHERE utente_id = ?').run(Number(id)); // le sessioni aperte decadono
}
export function impostaAttivo(id, attivo) {
  const u = perId(id);
  if (!u) throw new Error('Utente non trovato');
  if (!attivo && u.ruolo === 'admin' && db.prepare("SELECT COUNT(*) n FROM utenti WHERE ruolo='admin' AND attivo=1").get().n <= 1) throw new Error('Non si può disattivare l\'ultimo amministratore');
  db.prepare('UPDATE utenti SET attivo = ? WHERE id = ?').run(attivo ? 1 : 0, Number(id));
  if (!attivo) db.prepare('DELETE FROM sessioni WHERE utente_id = ?').run(Number(id));
}
export const cambiaRuolo = (id, ruolo) => {
  if (!RUOLI.includes(ruolo)) throw new Error('Ruolo non valido');
  const u = perId(id);
  if (!u) throw new Error('Utente non trovato');
  if (u.ruolo === 'admin' && ruolo !== 'admin' && db.prepare("SELECT COUNT(*) n FROM utenti WHERE ruolo='admin' AND attivo=1").get().n <= 1) throw new Error('Non si può togliere il ruolo all\'ultimo amministratore');
  db.prepare('UPDATE utenti SET ruolo = ? WHERE id = ?').run(ruolo, Number(id));
};
export const quantiUtenti = () => db.prepare('SELECT COUNT(*) n FROM utenti').get().n;

// ---------- sessioni
function apriSessione(utente, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const scade = new Date(Date.now() + config.sessioneOre * 3600_000).toISOString();
  db.prepare('INSERT INTO sessioni(token_hash,utente_id,creata,scade,ip,agente) VALUES (?,?,?,?,?,?)').run(sha(token), utente.id, ora(), scade, ipDi(req), String(req.headers['user-agent'] ?? '').slice(0, 200));
  db.prepare('UPDATE utenti SET ultimo_accesso = ? WHERE id = ?').run(ora(), utente.id);
  db.prepare('DELETE FROM sessioni WHERE scade < ?').run(ora());
  return { token, scade };
}
const cookieDi = (req) => Object.fromEntries(String(req.headers.cookie ?? '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
function utenteDaSessione(req) {
  const token = cookieDi(req).sid;
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessioni WHERE token_hash = ?').get(sha(token));
  if (!s || s.scade < ora()) return null;
  const u = perId(s.utente_id);
  return u && u.attivo ? u : null;
}
const sicuro = (req) => req.secure || String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
const impostaCookie = (req, res, token) => res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${config.sessioneOre * 3600}${sicuro(req) ? '; Secure' : ''}`);
const cancellaCookie = (req, res) => res.setHeader('Set-Cookie', `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${sicuro(req) ? '; Secure' : ''}`);
const ipDi = (req) => String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim().slice(0, 60);

// ---------- registro
export function registra({ utente = null, username = null, azione, dettaglio = null, esito = null, ip = null }) {
  try {
    db.prepare('INSERT INTO registro(quando,utente_id,username,azione,dettaglio,esito,ip) VALUES (?,?,?,?,?,?,?)').run(ora(), utente?.id ?? null, utente?.username ?? username, azione, dettaglio == null ? null : JSON.stringify(dettaglio).slice(0, 4000), esito, ip);
  } catch { /* il registro non deve mai bloccare il lavoro */ }
}
export function leggiRegistro({ utente = '', azione = '', da = '', a = '', limit = 100, offset = 0 } = {}) {
  const w = []; const p = {};
  if (utente) { w.push('username = @utente COLLATE NOCASE'); p.utente = utente; }
  if (azione) { w.push('azione LIKE @azione'); p.azione = `%${azione}%`; }
  if (da) { w.push('quando >= @da'); p.da = `${da}T00:00:00`; }
  if (a) { w.push('quando <= @a'); p.a = `${a}T23:59:59.999Z`; }
  const dove = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const righe = db.prepare(`SELECT * FROM registro ${dove} ORDER BY id DESC LIMIT @limit OFFSET @offset`).all({ ...p, limit: Math.min(500, Math.max(1, limit)), offset: Math.max(0, offset) })
    .map((r) => ({ ...r, dettaglio: r.dettaglio ? JSON.parse(r.dettaglio) : null }));
  return { righe, totale: db.prepare(`SELECT COUNT(*) n FROM registro ${dove}`).get(p).n };
}

// ---------- permessi
/** Cosa può fare ogni ruolo. Il magazzino vede solo i fogli rilasciati e può segnarli «preparati». */
export function consentito(ruolo, metodo, percorso) {
  if (percorso.startsWith('/api/auth') || percorso === '/api/info') return true;
  if (ruolo === 'admin') return true;
  if (ruolo === 'ufficio') return !(percorso.startsWith('/api/utenti') || percorso.startsWith('/api/registro'));
  if (ruolo === 'magazzino') return (metodo === 'GET' && percorso === '/api/picking/rilasci') || (metodo === 'POST' && percorso === '/api/picking/rilasci/stato');
  return false;
}

const ETICHETTE = [
  [/^POST \/api\/upload$/, () => 'Carica DDT in entrata'],
  [/^PUT \/api\/ddt\/(\d+)$/, (m) => `Salva modifiche DDT in entrata #${m[1]}`],
  [/^POST \/api\/ddt\/(\d+)\/invia$/, (m) => `Conferma e carica su Giobby il DDT in entrata #${m[1]}`],
  [/^POST \/api\/ddt\/(\d+)\/aggiorna$/, (m) => `Correzione di un DDT in entrata già caricato #${m[1]}`],
  [/^POST \/api\/ddt\/(\d+)\/scarta$/, (m) => `Scarta DDT in entrata #${m[1]}`],
  [/^POST \/api\/ddt\/(\d+)\/residuo\/chiudi$/, (m) => `Chiusura del resto dell'ordine del DDT #${m[1]}`],
  [/^POST \/api\/picking\/ddt$/, () => 'Crea DDT in uscita'],
  [/^POST \/api\/picking\/rilasci$/, () => 'Rilascia al magazzino'],
  [/^POST \/api\/picking\/rilasci\/stato$/, () => 'Magazzino: cambia stato ordine'],
  [/^POST \/api\/picking\/rilasci\/preparate$/, () => 'Ufficio: corregge quantità/lotti preparati'],
  [/^POST \/api\/picking\/rilasci\/verifica$/, () => 'Ufficio: verifica e blocca ordine preparato'],
  [/^POST \/api\/picking\/rilasci\/sblocca$/, () => 'Ufficio: sblocca ordine verificato'],
  [/^POST \/api\/picking\/rilasci\/ritira$/, () => 'Ritira un ordine dal magazzino'],
  [/^POST \/api\/utenti$/, () => 'Crea utente'],
  [/^POST \/api\/utenti\/(\d+)\/password$/, (m) => `Reimposta password utente #${m[1]}`],
  [/^POST \/api\/utenti\/(\d+)\/attivo$/, (m) => `Attiva/disattiva utente #${m[1]}`],
  [/^POST \/api\/utenti\/(\d+)\/ruolo$/, (m) => `Cambia ruolo utente #${m[1]}`],
  [/^POST \/api\/auth\/password$/, () => 'Cambia la propria password'],
];
const SEGRETI = /pass|token|secret/i;
function riassunto(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const out = {};
  for (const [k, v] of Object.entries(b)) {
    if (SEGRETI.test(k)) continue;
    if (Array.isArray(v)) out[k] = k === 'prelievi' || k === 'previsto' || k === 'preparate' ? v.map((x) => `${x.articolo}${x.lotto ? ` ${x.lotto}` : ''} ×${x.quantita}`) : k === 'ordini' ? v.map((x) => x.id) : `${v.length} elementi`;
    else if (typeof v !== 'object') out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  if (req.file?.originalname) out.file = req.file.originalname;
  return out;
}

// ---------- tentativi di accesso
const tentativi = new Map();
const MAX_TENTATIVI = 5; const BLOCCO_MS = 5 * 60_000;
const bloccato = (k) => (tentativi.get(k)?.fino ?? 0) > Date.now();
function sbagliato(k) { const t = tentativi.get(k) ?? { n: 0, fino: 0 }; t.n += 1; if (t.n >= MAX_TENTATIVI) { t.fino = Date.now() + BLOCCO_MS; t.n = 0; } tentativi.set(k, t); }

export function authRouter() {
  const r = express.Router();
  r.post('/login', (req, res) => {
    const d = z.object({ username: z.string().max(60), password: z.string().max(200) }).safeParse(req.body);
    if (!d.success) return res.status(400).json({ error: 'Inserisci utente e password' });
    const chiave = `${ipDi(req)}|${d.data.username.toLowerCase()}`;
    if (bloccato(chiave)) return res.status(429).json({ error: 'Troppi tentativi: riprova tra qualche minuto' });
    const u = perUsername(d.data.username);
    const ok = verificaPassword(d.data.password, u?.hash ?? HASH_FINTO) && u && u.attivo;
    if (!ok) {
      sbagliato(chiave);
      registra({ username: d.data.username.slice(0, 60), azione: 'Accesso negato', esito: u && !u.attivo ? 'utente disattivato' : 'credenziali errate', ip: ipDi(req) });
      return res.status(401).json({ error: 'Utente o password non corretti' });
    }
    tentativi.delete(chiave);
    const s = apriSessione(u, req);
    impostaCookie(req, res, s.token);
    registra({ utente: u, azione: 'Accesso', ip: ipDi(req) });
    res.json({ utente: pubblico(u) });
  });
  r.post('/logout', (req, res) => {
    const u = utenteDaSessione(req);
    const token = cookieDi(req).sid;
    if (token) db.prepare('DELETE FROM sessioni WHERE token_hash = ?').run(sha(token));
    cancellaCookie(req, res);
    if (u) registra({ utente: u, azione: 'Uscita', ip: ipDi(req) });
    res.json({ ok: true });
  });
  r.get('/me', (req, res) => {
    const u = utenteDaSessione(req);
    if (!u) return res.status(401).json({ error: 'Non hai effettuato l\'accesso' });
    res.json({ utente: pubblico(u) });
  });
  r.post('/password', (req, res) => {
    const u = utenteDaSessione(req);
    if (!u) return res.status(401).json({ error: 'Non hai effettuato l\'accesso' });
    const d = z.object({ vecchia: z.string().max(200), nuova: z.string().max(200) }).safeParse(req.body);
    if (!d.success) return res.status(400).json({ error: 'Dati non validi' });
    if (!verificaPassword(d.data.vecchia, u.hash)) return res.status(403).json({ error: 'La password attuale non è corretta' });
    try { cambiaPassword(u.id, d.data.nuova); } catch (e) { return res.status(400).json({ error: e.message }); }
    const s = apriSessione(u, req); impostaCookie(req, res, s.token); // la sessione corrente continua
    registra({ utente: u, azione: 'Cambia la propria password', ip: ipDi(req) });
    res.json({ ok: true });
  });
  return r;
}

export function utentiRouter() {
  const r = express.Router();
  r.get('/', (_req, res) => res.json({ utenti: elencoUtenti(), ruoli: RUOLI }));
  const tryRes = (res, fn) => { try { res.json(fn()); } catch (e) { res.status(400).json({ error: e.message }); } };
  r.post('/', (req, res) => tryRes(res, () => ({ utente: creaUtente(z.object({ username: z.string(), nome: z.string().optional(), ruolo: z.string(), password: z.string() }).parse(req.body)) })));
  r.post('/:id/password', (req, res) => tryRes(res, () => { cambiaPassword(req.params.id, z.object({ password: z.string() }).parse(req.body).password); return { ok: true }; }));
  r.post('/:id/attivo', (req, res) => tryRes(res, () => { if (Number(req.params.id) === req.utente?.id) throw new Error('Non puoi disattivare te stesso'); impostaAttivo(req.params.id, z.object({ attivo: z.boolean() }).parse(req.body).attivo); return { ok: true }; }));
  r.post('/:id/ruolo', (req, res) => tryRes(res, () => { cambiaRuolo(req.params.id, z.object({ ruolo: z.string() }).parse(req.body).ruolo); return { ok: true }; }));
  return r;
}

export function registroRouter() {
  const r = express.Router();
  r.get('/', (req, res) => {
    const s = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
    const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(s(v)) ? s(v) : '');
    const n = (v, def) => { const x = Number.parseInt(v, 10); return Number.isFinite(x) ? x : def; };
    res.json(leggiRegistro({ utente: s(req.query.utente), azione: s(req.query.azione), da: iso(req.query.da), a: iso(req.query.a), limit: n(req.query.limit, 100), offset: n(req.query.offset, 0) }));
  });
  r.get('/utenti', (_req, res) => res.json({ utenti: db.prepare('SELECT DISTINCT username FROM registro WHERE username IS NOT NULL ORDER BY username').all().map((x) => x.username) }));
  return r;
}

/** Monta il login su tutta l'API: sessione obbligatoria, permessi per ruolo, registro delle azioni che modificano qualcosa. */
export function installaAuth(app) {
  app.use('/api/auth', authRouter());
  app.use('/api', (req, res, next) => {
    const u = utenteDaSessione(req);
    if (!u) return res.status(401).json({ error: 'Accedi per continuare' });
    const percorso = req.originalUrl.split('?')[0];
    if (!consentito(u.ruolo, req.method, percorso)) {
      registra({ utente: u, azione: 'Azione non consentita', dettaglio: { richiesta: `${req.method} ${percorso}` }, esito: '403', ip: ipDi(req) });
      return res.status(403).json({ error: 'Non hai il permesso per questa operazione' });
    }
    req.utente = u;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      let corpoRisposta = null;
      const json = res.json.bind(res);
      res.json = (b) => { corpoRisposta = b; return json(b); };
      res.on('finish', () => {
        const chiave = `${req.method} ${percorso}`;
        const et = ETICHETTE.find(([re]) => re.test(chiave));
        const dettaglio = riassunto(req);
        if (corpoRisposta?.riferimento) dettaglio.risultato = corpoRisposta.riferimento;
        if (corpoRisposta?.error && res.statusCode >= 400) dettaglio.errore = String(corpoRisposta.error).slice(0, 300);
        registra({ utente: u, azione: et ? et[1](re_match(et[0], chiave)) : chiave, dettaglio, esito: res.statusCode < 400 ? 'ok' : `errore ${res.statusCode}`, ip: ipDi(req) });
      });
    }
    next();
  });
  app.use('/api/utenti', utentiRouter());
  app.use('/api/registro', registroRouter());
}
const re_match = (re, s) => re.exec(s);
