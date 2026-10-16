// API del Modulo B. Montata da createApp() SOLO se MODULO_B=on nel .env: altrimenti /api/picking risponde 404.
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
  // Back office: emette il DDT in uscita con i lotti indicati (quelli del picking, corretti con le note dell'operatore).
  r.post('/ddt', async (req, res) => {
    const dati = z.object({
      ordine: z.number().int().positive(),
      prelievi: z.array(z.object({
        articolo: z.string().min(1), lotto: z.string().nullish(), scadenza: z.string().nullish(), quantita: z.number().positive(),
      })).min(1).max(200),
    }).safeParse(req.body);
    if (!dati.success) return res.status(400).json({ error: 'Dati non validi', dettaglio: dati.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
    try {
      res.json({ ok: true, ...(await getGiobbyClient().emettiDdtUscita(dati.data.ordine, dati.data.prelievi)) });
    } catch (e) {
      res.status(422).json({ ok: false, error: e.message || String(e) });
    }
  });
  return r;
}
