// API del Modulo B. Montata da createApp() SOLO se MODULO_B=on nel .env: altrimenti /api/picking risponde 404.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { getGiobbyClient } from './giobby.js';
import { pianificaPicking } from './picking.js';

const Dati = z.object({
  ordini: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    consegna: z.string().nullish(),
    righe: z.array(z.object({ articolo: z.string(), quantita: z.number() })).max(500),
  })).max(200),
  giacenze: z.array(z.object({
    articolo: z.string(),
    lotto: z.string().nullish(),
    scadenza: z.string().nullish(),
    ubicazione: z.string().nullish(),
    disponibile: z.number(),
  })).max(5000),
  oggi: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const FILE_STORICO = () => path.join(config.dataDir, 'ddt-uscita-storico.jsonl');
function registraStorico(voce) {
  try { fs.appendFileSync(FILE_STORICO(), `${JSON.stringify({ quando: new Date().toISOString(), ...voce })}\n`); } catch { /* lo storico non deve mai bloccare il DDT */ }
}

// ---------- Rilascio al magazzino: l'ufficio (Tania) decide cosa preparare, il magazziniere (Luca) vede solo quello che è rilasciato.
const FILE_RILASCI = () => path.join(config.dataDir, 'picking-rilasci.json');
function leggiRilasci() {
  try { return fs.existsSync(FILE_RILASCI()) ? JSON.parse(fs.readFileSync(FILE_RILASCI(), 'utf8')) : {}; } catch { return {}; }
}
function scriviRilasci(r) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE_RILASCI(), JSON.stringify(r, null, 2));
}
const RigaRilascio = z.object({ articolo: z.string().min(1), descrizione: z.string().nullish(), lotto: z.string().nullish(), scadenza: z.string().nullish(), ubicazione: z.string().nullish(), quantita: z.number().positive() });
// Riga preparata dal magazziniere (o corretta dall'ufficio): può essere 0 se non l'ha trovata.
const RigaPreparata = z.object({ articolo: z.string().min(1), descrizione: z.string().nullish(), lotto: z.string().nullish(), scadenza: z.string().nullish(), ubicazione: z.string().nullish(), quantita: z.number().min(0).max(1e7) });
const Rilascio = z.object({
  id: z.string().min(1).max(60), idGiobby: z.union([z.string(), z.number()]).nullish(),
  cliente: z.string().min(1).max(200), provincia: z.string().nullish(), consegna: z.string().nullish(),
  righe: z.array(RigaRilascio).min(1).max(300),
});
const arr = (n) => Math.round(n * 1000) / 1000;
const totaliPerArticolo = (righe) => { const t = {}; for (const r of righe ?? []) t[r.articolo] = arr((t[r.articolo] ?? 0) + Number(r.quantita)); return t; };
const richiesteDi = (v) => v.richieste ?? totaliPerArticolo(v.righe);
// Fasi: rilasciato (da preparare) → preparato (il magazziniere ha finito) → verificato (l'ufficio ha controllato: bloccato).
const BLOCCATO = (v) => v.stato === 'verificato';
const IMPEGNA = (v) => v.stato === 'preparato' || v.stato === 'verificato';

/** Le quantità preparate non possono superare quelle richieste, né riguardare articoli che non erano nell'ordine rilasciato. */
function controllaPreparate(v, preparate) {
  const rich = richiesteDi(v); const tot = totaliPerArticolo(preparate);
  for (const [art, q] of Object.entries(tot)) {
    if (!(art in rich)) throw new Error(`L'articolo ${art} non è in questo ordine`);
    if (q > rich[art] + 1e-9) throw new Error(`${art}: preparate ${q} ma ne servono ${rich[art]}`);
  }
}

/**
 * Dopo ogni correzione di un lotto: le giacenze si riducono di quanto è GIÀ stato preparato o verificato (quei fogli sono in mano al magazziniere
 * e non si toccano) e gli ordini ancora «da preparare» vengono ricalcolati, in ordine di data di consegna, sulla giacenza che resta.
 */
export async function ricalcolaRilasciati(client = getGiobbyClient()) {
  const tutti = leggiRilasci();
  const daRifare = Object.values(tutti).filter((v) => v.stato === 'rilasciato');
  if (!daRifare.length) return { ricalcolati: [], avvisi: [] };
  const giac = (await client.giacenze({})).map((g) => ({ ...g }));
  for (const v of Object.values(tutti).filter(IMPEGNA)) {
    for (const p of v.preparate ?? v.righe) {
      const g = giac.find((x) => x.articolo === p.articolo && (x.lotto ?? null) === (p.lotto ?? null));
      if (g) g.disponibile = Math.max(0, arr(g.disponibile - Number(p.quantita)));
    }
  }
  const piano = pianificaPicking({ ordini: daRifare.map((v) => ({ id: v.id, consegna: v.consegna, righe: Object.entries(richiesteDi(v)).map(([articolo, quantita]) => ({ articolo, quantita })) })), giacenze: giac });
  const ricalcolati = []; const avvisi = [];
  for (const o of piano.ordini) {
    const v = tutti[o.id];
    const nuove = o.prelievi.map((p) => ({ articolo: p.articolo, descrizione: v.righe.find((r) => r.articolo === p.articolo)?.descrizione ?? null, lotto: p.lotto, scadenza: p.scadenza, ubicazione: p.ubicazione, quantita: p.quantita }));
    const firma = (rr) => JSON.stringify(rr.map((r) => [r.articolo, r.lotto ?? null, r.quantita]));
    v.mancanti = o.mancanti;
    if (firma(nuove) !== firma(v.righe)) { v.righe = nuove; v.ricalcolatoIl = new Date().toISOString(); ricalcolati.push(o.id); }
    if (o.mancanti.length) avvisi.push(`${o.id}: ${o.mancanti.map((m) => `${m.articolo} mancano ${m.mancante}`).join(', ')}`);
  }
  if (ricalcolati.length || piano.ordini.length) scriviRilasci(tutti);
  return { ricalcolati, avvisi };
}
const ricalcolaSicuro = async () => { try { return await ricalcolaRilasciati(); } catch (e) { return { ricalcolati: [], avvisi: [], errore: `Ricalcolo non riuscito: ${e.message || e}` }; } };

export const rimuoviRilascio = (idGiobby) => {
  const r = leggiRilasci();
  const chiavi = Object.keys(r).filter((k) => String(r[k].idGiobby ?? '') === String(idGiobby));
  if (!chiavi.length) return;
  chiavi.forEach((k) => delete r[k]);
  scriviRilasci(r);
};

export function pickingRouter() {
  const r = express.Router();
  r.get('/stato', (_req, res) => res.json({ attivo: true, fase: 'sviluppo', note: 'Calcolo FEFO attivo; giacenze lette da Giobby; ordini di vendita letti da Giobby.' }));
  // Giacenze disponibili per lotto: da Giobby (GIOBBY_MODE=api) oppure di prova. ?magazzino=MB per un solo magazzino.
  r.get('/giacenze', async (req, res) => {
    const magazzino = typeof req.query.magazzino === 'string' ? req.query.magazzino.trim().slice(0, 20) : '';
    try {
      res.json({ fonte: config.giobbyMode === 'api' ? 'giobby' : 'prova', giacenze: await getGiobbyClient().giacenze({ magazzino: magazzino || null }) });
    } catch (e) {
      res.status(502).json({ error: `Giobby: ${e.message || e}` });
    }
  });
  // Ordini di vendita ancora da evadere: da Giobby (GIOBBY_MODE=api) oppure di prova.
  r.get('/ordini', async (_req, res) => {
    try {
      res.json({ fonte: config.giobbyMode === 'api' ? 'giobby' : 'prova', ordini: await getGiobbyClient().ordiniVendita() });
    } catch (e) {
      res.status(502).json({ error: `Giobby: ${e.message || e}` });
    }
  });
  // Ordini già usciti (DDT emesso / evasi in Giobby), solo per consultarli.
  r.get('/ordini-evasi', async (_req, res) => {
    try { res.json({ ordini: await getGiobbyClient().ordiniEvasi() }); } catch (e) { res.status(502).json({ error: `Giobby: ${e.message || e}` }); }
  });
  // Calcola il piano di prelievo su dati mandati dal browser (demo/collaudo). Il collegamento a Giobby arriva dopo.
  r.post('/simula', (req, res) => {
    const dati = Dati.safeParse(req.body);
    if (!dati.success) return res.status(400).json({ error: 'Dati non validi', dettaglio: dati.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
    try {
      res.json(pianificaPicking(dati.data));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  // Rilasci: elenco (ufficio e magazzino), rilascio di uno o più ordini, ritiro, stato «preparato» con nota dell'operatore.
  r.get('/rilasci', (_req, res) => res.json({ rilasci: Object.values(leggiRilasci()).sort((a, b) => String(a.consegna ?? '9').localeCompare(String(b.consegna ?? '9')) || a.cliente.localeCompare(b.cliente, 'it')) }));
  r.post('/rilasci', (req, res) => {
    const dati = z.object({ ordini: z.array(Rilascio).min(1).max(100) }).safeParse(req.body);
    if (!dati.success) return res.status(400).json({ error: 'Dati non validi', dettaglio: dati.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
    const tutti = leggiRilasci();
    for (const o of dati.data.ordini) {
      if (tutti[o.id] && IMPEGNA(tutti[o.id])) continue; // già in mano al magazzino o verificato: non si sovrascrive
      tutti[o.id] = { ...o, richieste: totaliPerArticolo(o.righe), stato: 'rilasciato', rilasciatoIl: new Date().toISOString(), preparatoIl: null, verificatoIl: null, preparate: null, nota: '' };
    }
    scriviRilasci(tutti);
    res.json({ ok: true, rilasciati: dati.data.ordini.length });
  });
  // Magazziniere: «ho preparato» (con le quantità effettive per lotto e la nota) oppure «riapri». Un ordine verificato è bloccato.
  r.post('/rilasci/stato', async (req, res) => {
    const dati = z.object({ id: z.string().min(1), stato: z.enum(['rilasciato', 'preparato']), nota: z.string().max(500).optional(), preparate: z.array(RigaPreparata).max(400).optional() }).safeParse(req.body);
    if (!dati.success) return res.status(400).json({ error: 'Dati non validi' });
    const tutti = leggiRilasci();
    const v = tutti[dati.data.id];
    if (!v) return res.status(404).json({ error: 'Ordine non rilasciato' });
    if (BLOCCATO(v)) return res.status(409).json({ error: 'Ordine già verificato dall\'ufficio: è bloccato' });
    if (dati.data.stato === 'preparato') {
      const prep = dati.data.preparate ?? v.preparate ?? v.righe;
      try { controllaPreparate(v, prep); } catch (e) { return res.status(400).json({ error: e.message }); }
      v.preparate = prep;
    } else { v.preparate = null; }
    v.stato = dati.data.stato; v.preparatoIl = dati.data.stato === 'preparato' ? new Date().toISOString() : null;
    if (dati.data.nota !== undefined) v.nota = dati.data.nota;
    scriviRilasci(tutti);
    res.json({ ok: true, ...(await ricalcolaSicuro()) });
  });
  // Ufficio: corregge le quantità/lotti preparati («conferma modifica»): gli altri ordini ancora da preparare si ricalcolano.
  r.post('/rilasci/preparate', async (req, res) => {
    const dati = z.object({ id: z.string().min(1), preparate: z.array(RigaPreparata).max(400), nota: z.string().max(500).optional() }).safeParse(req.body);
    if (!dati.success) return res.status(400).json({ error: 'Dati non validi' });
    const tutti = leggiRilasci();
    const v = tutti[dati.data.id];
    if (!v) return res.status(404).json({ error: 'Ordine non rilasciato' });
    if (BLOCCATO(v)) return res.status(409).json({ error: 'Ordine verificato: è bloccato. Sbloccalo per modificarlo' });
    try { controllaPreparate(v, dati.data.preparate); } catch (e) { return res.status(400).json({ error: e.message }); }
    v.preparate = dati.data.preparate; if (v.stato === 'rilasciato') { v.stato = 'preparato'; v.preparatoIl = new Date().toISOString(); }
    if (dati.data.nota !== undefined) v.nota = dati.data.nota;
    scriviRilasci(tutti);
    res.json({ ok: true, ...(await ricalcolaSicuro()) });
  });
  // Ufficio: «tutto ok» → l'ordine si blocca (lucchetto) e può uscire con il DDT.
  r.post('/rilasci/verifica', (req, res) => {
    const dati = z.object({ id: z.string().min(1) }).safeParse(req.body);
    if (!dati.success) return res.status(400).json({ error: 'Dati non validi' });
    const tutti = leggiRilasci();
    const v = tutti[dati.data.id];
    if (!v) return res.status(404).json({ error: 'Ordine non rilasciato' });
    if (v.stato !== 'preparato') return res.status(409).json({ error: 'Si può verificare solo un ordine già preparato dal magazzino' });
    v.stato = 'verificato'; v.verificatoIl = new Date().toISOString();
    scriviRilasci(tutti);
    res.json({ ok: true });
  });
  r.post('/rilasci/sblocca', async (req, res) => {
    const dati = z.object({ id: z.string().min(1) }).safeParse(req.body);
    if (!dati.success) return res.status(400).json({ error: 'Dati non validi' });
    const tutti = leggiRilasci();
    const v = tutti[dati.data.id];
    if (!v) return res.status(404).json({ error: 'Ordine non rilasciato' });
    if (!BLOCCATO(v)) return res.status(409).json({ error: 'L\'ordine non è bloccato' });
    v.stato = 'preparato'; v.verificatoIl = null;
    scriviRilasci(tutti);
    res.json({ ok: true });
  });
  r.post('/rilasci/ritira', (req, res) => {
    const dati = z.object({ id: z.string().min(1) }).safeParse(req.body);
    if (!dati.success) return res.status(400).json({ error: 'Dati non validi' });
    const tutti = leggiRilasci();
    delete tutti[dati.data.id];
    scriviRilasci(tutti);
    res.json({ ok: true });
  });
  // Storico: cosa prevedeva il picking e cosa è finito nel DDT (ultimi 50)
  r.get('/storico', (_req, res) => {
    try {
      const righe = fs.existsSync(FILE_STORICO()) ? fs.readFileSync(FILE_STORICO(), 'utf8').split('\n').filter(Boolean).slice(-50).map((l) => JSON.parse(l)) : [];
      res.json({ storico: righe.reverse() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // PDF del DDT di uscita (quello stampato da Giobby)
  r.get('/ddt/:id/pdf', async (req, res) => {
    try {
      const pdf = await getGiobbyClient().pdfDdtUscita(req.params.id);
      res.type('application/pdf').set('Content-Disposition', `inline; filename="DDT-${Number(req.params.id)}.pdf"`).send(pdf);
    } catch (e) {
      res.status(502).json({ error: e.message || String(e) });
    }
  });
  // Back office: emette il DDT in uscita con i lotti indicati (quelli del picking, corretti con le note dell'operatore).
  r.post('/ddt', async (req, res) => {
    const dati = z.object({
      ordine: z.number().int().positive(),
      prelievi: z.array(z.object({
        articolo: z.string().min(1), lotto: z.string().nullish(), scadenza: z.string().nullish(), quantita: z.number().positive(),
      })).min(1).max(200),
      parziale: z.boolean().optional(),
      previsto: z.array(z.object({ articolo: z.string(), lotto: z.string().nullish(), quantita: z.number() })).max(200).optional(),
    }).safeParse(req.body);
    if (!dati.success) return res.status(400).json({ error: 'Dati non validi', dettaglio: dati.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
    try {
      const esito = await getGiobbyClient().emettiDdtUscita(dati.data.ordine, dati.data.prelievi, { parziale: !!dati.data.parziale });
      rimuoviRilascio(dati.data.ordine);
      registraStorico({ ordine: dati.data.ordine, ddt: esito.riferimento, idDdt: esito.idDdt, previsto: dati.data.previsto ?? null, effettivo: dati.data.prelievi.map((p) => ({ articolo: p.articolo, lotto: p.lotto ?? null, quantita: p.quantita })), parziale: !!dati.data.parziale });
      res.json({ ok: true, ...esito });
    } catch (e) {
      res.status(422).json({ ok: false, error: e.message || String(e) });
    }
  });
  return r;
}
