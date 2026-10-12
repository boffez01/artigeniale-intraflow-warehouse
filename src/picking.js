// Modulo B · cuore del picking: dato un elenco di ordini di vendita e le giacenze per lotto, decide DA QUALE lotto
// prelevare (prima scade, prima esce: FEFO) e in che ORDINE girare il magazzino. Nessuna rete, nessun DB: solo calcolo,
// così si collauda con dati finti e i dati veri (Giobby) si collegano dopo.
//
// Regole (modificabili in REGOLE finché non le confermano in Artigeniale):
//  - lotti scaduti (scadenza < oggi): mai prelevati, segnalati
//  - tra i lotti validi: scadenza più vicina per prima; a parità, ubicazione in ordine naturale (A-01-2 prima di A-01-10)
//  - più ordini: si servono nell'ordine di data consegna (poi nell'ordine ricevuto) e consumano la stessa giacenza
//  - quantità non coperta: ordine "parziale" o "non_evadibile" con il dettaglio di cosa manca (mai un prelievo inventato)
import { oggiIso } from './giobbyCarico.js';

export const REGOLE = {
  scadutiEsclusi: true,
};

const norm = (s) => String(s ?? '').trim().toUpperCase();
const naturale = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'it', { numeric: true, sensitivity: 'base' });
const SENZA_SCADENZA = '9999-12-31'; // chi non ha scadenza esce dopo chi ce l'ha
const arrotonda = (n) => Math.round(n * 1000) / 1000;

function controlla({ ordini, giacenze }) {
  if (!Array.isArray(ordini) || !Array.isArray(giacenze)) throw new Error('Servono ordini[] e giacenze[]');
  for (const o of ordini) {
    for (const r of o.righe ?? []) {
      if (!norm(r.articolo)) throw new Error(`Ordine ${o.id}: riga senza articolo`);
      if (!(Number(r.quantita) > 0)) throw new Error(`Ordine ${o.id}, ${r.articolo}: la quantità deve essere maggiore di zero`);
    }
  }
  for (const g of giacenze) {
    if (!norm(g.articolo)) throw new Error('Giacenza senza articolo');
    if (!(Number(g.disponibile) >= 0)) throw new Error(`Giacenza ${g.articolo}: quantità disponibile non valida`);
  }
}

/**
 * @param {{ordini:{id:string|number, consegna?:string, righe:{articolo:string, quantita:number}[]}[],
 *          giacenze:{articolo:string, lotto?:string, scadenza?:string, ubicazione?:string, disponibile:number}[],
 *          oggi?:string}} dati
 * @returns {{ordini:object[], percorso:object[], scaduti:object[]}}
 */
export function pianificaPicking({ ordini = [], giacenze = [], oggi = oggiIso() } = {}) {
  controlla({ ordini, giacenze });

  const scaduti = [];
  const magazzino = new Map(); // articolo -> lotti ancora prelevabili (copie: l'input non si modifica)
  for (const g of giacenze) {
    const disponibile = Number(g.disponibile);
    if (disponibile <= 0) continue;
    const lotto = { articolo: norm(g.articolo), lotto: g.lotto ?? null, scadenza: g.scadenza || null, ubicazione: g.ubicazione ?? null, disponibile };
    if (REGOLE.scadutiEsclusi && lotto.scadenza && lotto.scadenza < oggi) {
      scaduti.push({ articolo: lotto.articolo, lotto: lotto.lotto, scadenza: lotto.scadenza, ubicazione: lotto.ubicazione, quantita: disponibile });
      continue;
    }
    if (!magazzino.has(lotto.articolo)) magazzino.set(lotto.articolo, []);
    magazzino.get(lotto.articolo).push(lotto);
  }
  for (const lotti of magazzino.values()) {
    lotti.sort((a, b) => (a.scadenza || SENZA_SCADENZA).localeCompare(b.scadenza || SENZA_SCADENZA) || naturale(a.ubicazione, b.ubicazione) || naturale(a.lotto, b.lotto));
  }

  const inOrdine = ordini
    .map((o, i) => ({ o, i }))
    .sort((x, y) => (x.o.consegna || SENZA_SCADENZA).localeCompare(y.o.consegna || SENZA_SCADENZA) || x.i - y.i)
    .map(({ o }) => o);

  const esito = inOrdine.map((ordine) => {
    const prelievi = [];
    const mancanti = [];
    for (const riga of ordine.righe ?? []) {
      const articolo = norm(riga.articolo);
      let resto = Number(riga.quantita);
      for (const lotto of magazzino.get(articolo) ?? []) {
        if (resto <= 0) break;
        const presa = Math.min(resto, lotto.disponibile);
        if (presa <= 0) continue;
        lotto.disponibile = arrotonda(lotto.disponibile - presa);
        resto = arrotonda(resto - presa);
        prelievi.push({ articolo, lotto: lotto.lotto, scadenza: lotto.scadenza, ubicazione: lotto.ubicazione, quantita: arrotonda(presa) });
      }
      if (resto > 0) {
        const richiesta = Number(riga.quantita);
        mancanti.push({ articolo, richiesta, prelevata: arrotonda(richiesta - resto), mancante: resto });
      }
    }
    const nRighe = (ordine.righe ?? []).length;
    const stato = !mancanti.length ? 'completo' : mancanti.length === nRighe && mancanti.every((m) => m.prelevata === 0) ? 'non_evadibile' : 'parziale';
    return { id: ordine.id, consegna: ordine.consegna ?? null, stato, prelievi, mancanti };
  });

  // Giro del magazzino: stesse ubicazioni vicine, in ordine; lo stesso lotto richiesto da più ordini si preleva in un colpo solo.
  const giro = new Map();
  for (const o of esito) {
    for (const p of o.prelievi) {
      const k = `${p.ubicazione}|${p.articolo}|${p.lotto}`;
      if (!giro.has(k)) giro.set(k, { ...p, quantita: 0, ordini: [] });
      const voce = giro.get(k);
      voce.quantita = arrotonda(voce.quantita + p.quantita);
      voce.ordini.push({ id: o.id, quantita: p.quantita });
    }
  }
  const percorso = [...giro.values()].sort((a, b) => naturale(a.ubicazione, b.ubicazione) || naturale(a.articolo, b.articolo) || naturale(a.lotto, b.lotto));

  return { ordini: esito, percorso, scaduti };
}