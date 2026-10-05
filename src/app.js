// Web app di verifica: carica DDT, controlla i dati letti, conferma e invia a Giobby.
// Il browser non è mai considerato affidabile: ogni POST rifà parse + normalizzazione + validazione.
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import * as db from './db.js';
import { confermaEInvia, ingest, salva, scarta, valuta } from './service.js';
import { normalize } from './validation.js';
import { DdtSchema } from './schemas.js';
import { indexPage, reviewPage } from './views.js';

// Cartella SEPARATA da quella del watcher: altrimenti watcher e web acquisirebbero lo stesso file due volte.
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${path.basename(file.originalname)}`),
  }),
});

const clean = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v) => {
  const s = (v ?? '').toString().trim().replace(',', '.');
  return s === '' || Number.isNaN(Number(s)) ? null : Number(s);
};

export function parseForm(b) {
  const righe = [];
  const n = Math.min(Math.max(Number(b.n_righe) || 0, 0), 500);
  for (let i = 0; i < n; i++) {
    righe.push({
      codice_articolo: clean(b[`r${i}_codice_articolo`]),
      descrizione: clean(b[`r${i}_descrizione`]),
      quantita: num(b[`r${i}_quantita`]),
      unita_misura: clean(b[`r${i}_unita_misura`]),
      lotto: clean(b[`r${i}_lotto`]),
      data_scadenza: clean(b[`r${i}_data_scadenza`]),
      campi_incerti: [],
    });
  }
  // DdtSchema.parse: stessa forma dei dati che escono da Gemini, qualunque cosa mandi il browser.
  return normalize(DdtSchema.parse({
    fornitore: clean(b.fornitore),
    partita_iva_fornitore: clean(b.partita_iva_fornitore),
    cliente: clean(b.cliente),
    numero_ddt: clean(b.numero_ddt),
    data_ddt: clean(b.data_ddt),
    numero_ordine_cliente: clean(b.numero_ordine_cliente),
    righe,
  }));
}

export function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false, parameterLimit: 5000 }));

  app.get('/', (_req, res) => res.send(indexPage(db.listAll())));

  app.post('/upload', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).send('Nessun file');
      const r = await ingest(req.file.path);
      res.redirect(303, `/ddt/${r.id}${r.duplicato ? '?dup=1' : ''}`);
    } catch (e) { next(e); }
  });

  const load = (req, res, next) => {
    const row = db.get(Number(req.params.id));
    if (!row) return res.status(404).send('DDT non trovato');
    req.row = row;
    next();
  };
  const editabile = (row) => ['da_verificare', 'errore'].includes(row.status);

  app.get('/ddt/:id', load, (req, res) => {
    const { row } = req;
    // Per i documenti ancora modificabili ricalcolo l'esito ad ogni visita (es. l'originale è stato scartato nel frattempo).
    const esito = editabile(row) && row.payload.righe ? valuta(row.payload, row.id).esito : row.warnings;
    res.send(reviewPage(row, { esito, dup: req.query.dup === '1' }));
  });

  app.get('/ddt/:id/file', load, (req, res) => res.sendFile(path.resolve(req.row.stored_path)));

  app.post('/ddt/:id/conferma', load, async (req, res, next) => {
    try {
      const { row } = req;
      const back = () => res.redirect(303, `/ddt/${row.id}`);
      if (!editabile(row)) return back();
      const ddt = parseForm(req.body);
      if (req.body.azione === 'salva') salva(row, ddt);
      else await confermaEInvia(row, ddt);
      back();
    } catch (e) { next(e); }
  });

  app.post('/ddt/:id/scarta', load, (req, res) => {
    scarta(req.row);
    res.redirect(303, '/');
  });

  return app;
}
