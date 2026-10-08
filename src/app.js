// API JSON per il frontend React. Il browser non è mai considerato affidabile:
// ogni richiesta rifà parse (Zod) + normalizzazione + validazione lato server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import * as db from './db.js';
import { confermaEInvia, ingest, salva, scarta, valuta } from './service.js';
import { normalize } from './validation.js';
import { DdtSchema } from './schemas.js';

// Cartella SEPARATA da quella del watcher: altrimenti watcher e web acquisirebbero lo stesso file due volte.
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${path.basename(file.originalname)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const clean = (v) => (v == null ? null : String(v).trim() || null);
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = (v ?? '').toString().trim().replace(',', '.');
  return s === '' || Number.isNaN(Number(s)) ? null : Number(s);
};

/** Costruisce un DDT valido da un JSON qualsiasi mandato dal browser (accetta anche "5,5" come quantità). */
export function buildDdt(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const righe = (Array.isArray(r.righe) ? r.righe : []).slice(0, 500).map((x) => ({
    codice_articolo: clean(x?.codice_articolo),
    descrizione: clean(x?.descrizione),
    quantita: num(x?.quantita),
    unita_misura: clean(x?.unita_misura),
    lotto: clean(x?.lotto),
    data_scadenza: clean(x?.data_scadenza),
    scadenza_a_fine_mese: x?.scadenza_a_fine_mese === true,
    // i dubbi di lettura restano finché l'utente non tocca il campo (il frontend li toglie quando lo modifica)
    campi_incerti: Array.isArray(x?.campi_incerti) ? x.campi_incerti.filter((c) => typeof c === 'string').slice(0, 10) : [],
  }));
  return normalize(DdtSchema.parse({
    fornitore: clean(r.fornitore),
    partita_iva_fornitore: clean(r.partita_iva_fornitore),
    cliente: clean(r.cliente),
    numero_ddt: clean(r.numero_ddt),
    data_ddt: clean(r.data_ddt),
    numero_ordine_cliente: clean(r.numero_ordine_cliente),
    causale_trasporto: clean(r.causale_trasporto),
    righe,
  }));
}

const STATI = ['da_verificare', 'in_invio', 'caricato', 'errore', 'scartato'];
const int = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Filtri dell'archivio dalla query string: tipi e limiti controllati, valori sconosciuti ignorati. */
export function filtri(qs = {}) {
  const s = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(s(v)) ? s(v) : '');
  return {
    q: s(qs.q),
    stati: s(qs.stato).split(',').filter((x) => STATI.includes(x)),
    fornitore: s(qs.fornitore),
    da: iso(qs.da),
    a: iso(qs.a),
    sort: s(qs.sort),
    dir: s(qs.dir) === 'asc' ? 'asc' : 'desc',
    limit: int(qs.limit, 25, 1, 100),
    offset: int(qs.offset, 0, 0, 1_000_000_000),
  };
}

// Cella CSV: virgolette se serve; i valori che iniziano con = + - @ vengono neutralizzati (formula injection in Excel).
function csvCell(v) {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(t)) t = `'${t}`;
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const editabile = (row) => ['da_verificare', 'errore'].includes(row.status);

const detail = (row) => ({
  id: row.id,
  filename: row.filename,
  status: row.status,
  giobby_ref: row.giobby_ref,
  error: row.error,
  created_at: row.created_at,
  file_type: /\.pdf$/i.test(row.stored_path) ? 'pdf' : 'image',
  pagina: row.pagina || 1, // pagina del file dove inizia questo DDT
  altri_ddt_del_file: db.findStessoFile(row.file_hash, row.id), // PDF con più DDT: gli altri
  editabile: editabile(row),
  ddt: row.payload,
  // per i documenti ancora modificabili l'esito si ricalcola ad ogni lettura (es. un originale scartato nel frattempo)
  esito: editabile(row) ? valuta(row.payload, row.id).esito : row.warnings,
});

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Stato del sistema per la barra in alto del front office (nessun segreto: solo modalità e se la chiave c'è).
  app.get('/api/info', (_req, res) =>
    res.json({ giobby_mode: config.giobbyMode, gemini_pronto: Boolean(config.geminiApiKey), modello: config.geminiModel }));

  // Archivio: ricerca, filtri, ordinamento, paginazione. Tutto validato qui, il browser non decide mai la SQL.
  app.get('/api/ddt', (req, res) => {
    const f = filtri(req.query);
    res.json({ ...db.search(f), counts: db.counts(), fornitori: db.fornitori(), limit: f.limit, offset: f.offset });
  });

  // Stessi filtri, tutte le righe, CSV con ; e BOM (si apre in Excel italiano senza passaggi).
  app.get('/api/ddt.csv', (req, res) => {
    const { items } = db.search({ ...filtri(req.query), limit: 0 });
    const righe = [['ID', 'Data DDT', 'N° DDT', 'Fornitore', 'N° ordine', 'Righe', 'Stato', 'Errori', 'Avvisi', 'Acquisito (UTC)', 'Rif. Giobby', 'File']];
    for (const r of items) {
      righe.push([r.id, r.data_ddt, r.numero_ddt, r.fornitore, r.ordine, r.n_righe, r.status, r.n_errori, r.n_avvisi, r.created_at, r.giobby_ref, r.filename]);
    }
    res.type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="ddt_${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(`\uFEFF${righe.map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`);
  });

  app.post('/api/upload', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
      const r = await ingest(req.file.path);
      if (!r) return res.status(409).json({ error: 'File già in elaborazione' });
      res.json(r); // { ids, id, duplicato }
    } catch (e) { next(e); }
  });

  const load = (req, res, next) => {
    const row = db.get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'DDT non trovato' });
    req.row = row;
    next();
  };

  app.get('/api/ddt/:id', load, (req, res) => res.json(detail(req.row)));
  app.get('/api/ddt/:id/file', load, (req, res) => res.sendFile(path.resolve(req.row.stored_path)));

  app.put('/api/ddt/:id', load, (req, res) => {
    const { row } = req;
    if (!editabile(row)) return res.status(409).json({ error: 'DDT non più modificabile' });
    salva(row, buildDdt(req.body));
    res.json(detail(db.get(row.id)));
  });

  app.post('/api/ddt/:id/invia', load, async (req, res, next) => {
    try {
      const { row } = req;
      if (!editabile(row)) return res.status(409).json({ error: 'DDT non più modificabile' });
      const out = await confermaEInvia(row, buildDdt(req.body));
      const fresh = db.get(row.id);
      res.status(out.ok ? 200 : 422).json({ ok: out.ok, ...detail(fresh), esito: out.esito });
    } catch (e) { next(e); }
  });

  app.post('/api/ddt/:id/scarta', load, (req, res) => {
    if (!scarta(req.row)) return res.status(409).json({ error: 'DDT non scartabile in questo stato' });
    res.json(detail(db.get(req.row.id)));
  });

  // Frontend compilato (npm run build). In sviluppo si usa il dev server di Vite con proxy su /api.
  const dist = fileURLToPath(new URL('../client/dist', import.meta.url));
  if (fs.existsSync(dist)) app.use(express.static(dist));
  else app.get('/', (_req, res) => res.type('text').send('Frontend non compilato: esegui "npm run build" (in sviluppo: "npm run dev:client").'));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err instanceof SyntaxError ? 400 : 500).json({ error: String(err.message || err) });
  });
  return app;
}