import Database from 'better-sqlite3';
import { config } from './config.js';

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS ddt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  status TEXT NOT NULL,      -- da_verificare | in_invio | caricato | errore | scartato
  payload TEXT NOT NULL,     -- JSON del DDT
  warnings TEXT NOT NULL DEFAULT '{"errori":[],"avvisi":[]}',
  giobby_ref TEXT,
  error TEXT,
  file_hash TEXT,            -- sha256 del file: stessa scansione caricata due volte
  chiave_ddt TEXT,           -- fornitore|n°DDT|data: stesso documento scansionato due volte
  numero_ddt TEXT,
  data_ddt TEXT,
  pagina INTEGER,            -- pagina del file dove inizia questo DDT
  indice_doc INTEGER,        -- posizione del DDT nel file (0,1,2...): un PDF può contenerne più di uno
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`);

// Migrazione per DB creati con versioni precedenti
const cols = db.prepare('PRAGMA table_info(ddt)').all().map((c) => c.name);
for (const c of ['file_hash', 'chiave_ddt', 'numero_ddt', 'data_ddt']) {
  if (!cols.includes(c)) db.exec(`ALTER TABLE ddt ADD COLUMN ${c} TEXT`);
}
for (const c of ['pagina', 'indice_doc']) {
  if (!cols.includes(c)) db.exec(`ALTER TABLE ddt ADD COLUMN ${c} INTEGER`);
}
db.exec('DROP INDEX IF EXISTS ux_ddt_hash'); // vecchio indice: un file = un DDT

// Vincoli a livello DB: ultima barriera contro i doppi caricamenti, anche con richieste concorrenti.
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS ux_ddt_hash_doc
  ON ddt(file_hash, indice_doc) WHERE file_hash IS NOT NULL AND indice_doc IS NOT NULL AND status NOT IN ('scartato','errore');
CREATE UNIQUE INDEX IF NOT EXISTS ux_ddt_chiave_inviato
  ON ddt(chiave_ddt) WHERE chiave_ddt IS NOT NULL AND status IN ('in_invio','caricato');
CREATE INDEX IF NOT EXISTS ix_ddt_numero ON ddt(numero_ddt, data_ddt);`);

const now = () => new Date().toISOString().slice(0, 19);
/** Esegue fn in una transazione: se qualcosa fallisce (es. indice univoco) non resta nulla a metà. */
export const tx = (fn) => db.transaction(fn)();
export const isUnique = (e) => e?.code === 'SQLITE_CONSTRAINT_UNIQUE';
const VUOTO = { errori: [], avvisi: [] };

export function insert({ filename, storedPath, status, payload, warnings = VUOTO, error = null, fileHash = null, indiceDoc = null, pagina = null, meta = {} }) {
  const r = db
    .prepare(`INSERT INTO ddt(filename,stored_path,status,payload,warnings,error,file_hash,indice_doc,pagina,chiave_ddt,numero_ddt,data_ddt,created_at,updated_at)
              VALUES (@filename,@storedPath,@status,@payload,@warnings,@error,@fileHash,@indiceDoc,@pagina,@chiave,@numero,@data,@t,@t)`)
    .run({
      filename, storedPath, status, payload: JSON.stringify(payload), warnings: JSON.stringify(warnings), error,
      fileHash, indiceDoc, pagina, chiave: meta.chiave_ddt ?? null, numero: meta.numero_ddt ?? null, data: meta.data_ddt ?? null, t: now(),
    });
  return Number(r.lastInsertRowid);
}

const hydrate = (row) => {
  if (!row) return row;
  const w = JSON.parse(row.warnings);
  return { ...row, payload: JSON.parse(row.payload), warnings: Array.isArray(w) ? VUOTO : w };
};

export const get = (id) => hydrate(db.prepare('SELECT * FROM ddt WHERE id=?').get(id));
export const listAll = () => db.prepare('SELECT * FROM ddt ORDER BY id DESC LIMIT 200').all();

// ---------------------------------------------------------------- Archivio (lista per il front office)
// Fornitore, n° righe e controlli si leggono direttamente dal JSON con le funzioni JSON di SQLite:
// nessuna colonna in più e nessuna migrazione.
const COLONNE_LISTA = `
  SELECT id, filename, status, created_at, numero_ddt, data_ddt, giobby_ref, pagina,
         json_extract(payload,'$.fornitore') AS fornitore,
         json_extract(payload,'$.numero_ordine_cliente') AS ordine,
         COALESCE(json_array_length(payload,'$.righe'),0) AS n_righe,
         COALESCE(json_array_length(warnings,'$.errori'),0) AS n_errori,
         COALESCE(json_array_length(warnings,'$.avvisi'),0) AS n_avvisi
  FROM ddt`;

// Whitelist: il nome della colonna di ordinamento non arriva mai dal browser dentro la query.
const ORDINA_PER = {
  id: 'id', data: 'data_ddt', numero: 'numero_ddt', fornitore: 'fornitore COLLATE NOCASE',
  righe: 'n_righe', stato: 'status', controlli: 'n_errori', acquisito: 'created_at',
};
const likeEsc = (s) => `%${String(s).replace(/[\\%_]/g, '\\$&')}%`;

function filtroSql({ q = '', stati = [], fornitore = '', da = '', a = '' }) {
  const where = [];
  const p = {};
  if (q) {
    p.q = likeEsc(q);
    const L = `LIKE @q ESCAPE '\\'`;
    const cond = [
      `filename ${L}`, `numero_ddt ${L}`,
      `json_extract(payload,'$.fornitore') ${L}`,
      `json_extract(payload,'$.numero_ordine_cliente') ${L}`,
      // tracciabilità: si cerca anche per lotto, codice o descrizione articolo
      `EXISTS (SELECT 1 FROM json_each(payload,'$.righe') r WHERE json_extract(r.value,'$.lotto') ${L}
               OR json_extract(r.value,'$.codice_articolo') ${L} OR json_extract(r.value,'$.descrizione') ${L})`,
    ];
    const m = /^#?(\d{1,9})$/.exec(q.trim());
    if (m) { cond.push('id = @idq'); p.idq = Number(m[1]); }
    where.push(`(${cond.join(' OR ')})`);
  }
  if (stati.length) {
    where.push(`status IN (${stati.map((_, i) => `@s${i}`).join(',')})`);
    stati.forEach((s, i) => { p[`s${i}`] = s; });
  }
  if (fornitore) { where.push(`json_extract(payload,'$.fornitore') = @forn`); p.forn = fornitore; }
  if (da) { where.push('data_ddt >= @da'); p.da = da; }
  if (a) { where.push('data_ddt <= @a'); p.a = a; }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', p };
}

/** Lista filtrata, ordinata e paginata. limit=0: tutte le righe (per l'export). */
export function search({ sort = 'id', dir = 'desc', limit = 25, offset = 0, ...filtri } = {}) {
  const { sql, p } = filtroSql(filtri);
  const col = ORDINA_PER[sort] || ORDINA_PER.id;
  const verso = dir === 'asc' ? 'ASC' : 'DESC';
  const paging = limit > 0 ? ' LIMIT @limit OFFSET @offset' : '';
  const items = db
    .prepare(`${COLONNE_LISTA}${sql} ORDER BY ${col} ${verso}, id DESC${paging}`)
    .all(limit > 0 ? { ...p, limit, offset } : p);
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ddt${sql}`).get(p);
  return { items, total: n };
}

/** Contatori per stato (su tutto l'archivio, indipendenti dai filtri) + acquisiti oggi (ora locale). */
export function counts() {
  const per = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM ddt GROUP BY status').all().map((r) => [r.status, r.n]));
  const { n: oggi } = db
    .prepare(`SELECT COUNT(*) AS n FROM ddt WHERE date(created_at,'localtime') = date('now','localtime') AND status<>'scartato'`)
    .get();
  const totale = Object.values(per).reduce((a, b) => a + b, 0);
  return { per_stato: per, totale, oggi };
}

/** Fornitori presenti in archivio (per il filtro a tendina). */
export const fornitori = () =>
  db.prepare(`SELECT DISTINCT json_extract(payload,'$.fornitore') AS f FROM ddt
              WHERE json_extract(payload,'$.fornitore') IS NOT NULL ORDER BY f COLLATE NOCASE`).all().map((r) => r.f);

export function update(id, fields) {
  const f = { ...fields, updated_at: now() };
  if (f.payload) f.payload = JSON.stringify(f.payload);
  if (f.warnings) f.warnings = JSON.stringify(f.warnings);
  const cols = Object.keys(f).map((k) => `${k}=@${k}`).join(', ');
  db.prepare(`UPDATE ddt SET ${cols} WHERE id=@id`).run({ ...f, id });
}

/** Stessa scansione (stessi byte) già acquisita: ritorna TUTTI i DDT ricavati da quel file (non scartati). */
export const findByHash = (hash) =>
  db.prepare(`SELECT id,status FROM ddt WHERE file_hash=? AND status NOT IN ('scartato','errore') ORDER BY id`).all(hash);

/** Gli ALTRI DDT ricavati dallo stesso file (PDF multipagina), nell'ordine in cui compaiono. */
export const findStessoFile = (hash, excludeId) =>
  hash
    ? db.prepare(`SELECT id,numero_ddt,status,pagina FROM ddt WHERE file_hash=? AND id<>? ORDER BY indice_doc, id`).all(hash, excludeId)
    : [];

/** Stesso DDT (stessa chiave) acquisito PRIMA di questo (id minore) e non scartato. */
export const findDuplicato = (chiave, beforeId) =>
  db.prepare(`SELECT id,status FROM ddt WHERE chiave_ddt=? AND id<? AND status<>'scartato' ORDER BY id LIMIT 1`)
    .get(chiave, beforeId) ?? null;

/** Stesso n° e data DDT ma chiave diversa (fornitore letto in modo diverso): solo avviso. */
export const findStessoNumero = (numero, data, chiave, beforeId) =>
  db.prepare(`SELECT id FROM ddt WHERE numero_ddt=? AND data_ddt=? AND id<? AND status<>'scartato'
              AND (chiave_ddt IS NULL OR chiave_ddt<>?)`).all(numero, data, beforeId, chiave ?? '');

/**
 * Prenota l'invio in modo atomico: da_verificare|errore -> in_invio.
 * Fallisce (false) se la riga è già in invio/caricata o se un altro DDT con la stessa chiave
 * è già in_invio/caricato (indice univoco). Due conferme concorrenti: una sola passa.
 */
export function claimInvio(id, chiave) {
  if (!chiave) return false;
  try {
    const r = db
      .prepare(`UPDATE ddt SET status='in_invio', chiave_ddt=?, updated_at=? WHERE id=? AND status IN ('da_verificare','errore')`)
      .run(chiave, now(), id);
    return r.changes === 1;
  } catch (e) {
    if (isUnique(e)) return false;
    throw e;
  }
}