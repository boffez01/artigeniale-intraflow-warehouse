// API del Modulo B. Montata da createApp() SOLO se MODULO_B=on nel .env: altrimenti /api/picking risponde 404.
import express from 'express';
import { z } from 'zod';
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
  r.get('/stato', (_req, res) => res.json({ attivo: true, fase: 'sviluppo', note: 'Calcolo FEFO attivo con dati di prova; collegamento a Giobby non ancora fatto.' }));
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
  return r;
}