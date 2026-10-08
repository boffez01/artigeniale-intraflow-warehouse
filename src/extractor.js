// Lettura dei DDT con Gemini (PDF o immagine -> lista di DDT strutturati).
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import { config } from './config.js';
import { EstrazioneSchema } from './schemas.js';

const PROMPT = `Sei un addetto di magazzino che registra merce in ingresso per un'azienda alimentare.
Il file allegato può contenere UNO O PIÙ documenti di trasporto (DDT), anche di fornitori diversi, uno per pagina o su più pagine.
Estrai OGNI DDT come elemento separato della lista "documenti".

Regole generali:
- NON inventare nulla. Se un dato non è presente o non è leggibile, usa null.
- 'pagina_inizio': numero della pagina del file (si parte da 1) in cui inizia quel DDT.
- Le date vanno in formato ISO AAAA-MM-GG (le date italiane sono GG/MM/AAAA o GG/MM/AA).

Testata:
- 'fornitore' e 'partita_iva_fornitore': chi EMETTE il DDT, dall'intestazione/logo in alto (solo le 11 cifre, senza IT).
  ATTENZIONE: la casella "Partita IVA / Codice fiscale" vicino al codice cliente è quella del CLIENTE (Artigeniale, 01115770297): NON usarla mai come P.IVA del fornitore.
- 'cliente': il destinatario (Spett.le / Destinatario).
- 'numero_ddt' e 'data_ddt': numero e data del documento (es. "Nr. Bolla", "D.D.T. n°", "Numero D.D.T.").
- 'numero_ordine_cliente': il NOSTRO numero d'ordine ("Vs. Ordine", "Ordine Cl. num."). NON usare il numero di conferma ordine del fornitore. Se non c'è, null.
- 'causale_trasporto': la causale scritta nel documento (es. "Vendita", "C/Lavorazione", "Reso c/to lavoro a cliente").

Righe:
- UNA RIGA PER OGNI LOTTO. Se un articolo ha più righe "Lotto: ..." crea una riga per ciascun lotto, con la quantità di QUEL lotto (la "Qta" sulla riga del lotto), non il totale dell'articolo.
- 'unita_misura' senza punti (KG, PZ, CT). Le quantità sono numeri col punto decimale (es. "1.396,000" -> 1396).
- 'lotto': il codice lotto stampato.
- 'data_scadenza': la scadenza della merce. Può essere stampata ("Scad. 28/02/28") oppure scritta A MANO accanto alla descrizione dell'articolo: leggila comunque.
  Se è completa restituisci AAAA-MM-GG. Se è scritta solo con mese e anno (es. "4/27", "06/27", "08/2026") restituisci AAAA-MM (es. "2027-04"). Se non è leggibile o non c'è, null.
- IGNORA le annotazioni a mano che sono calcoli o conteggi (es. "11,34 x 36", "2,5 x 200", "9,82 x 44"): non sono quantità né scadenze.
- IGNORA timbri, firme e le date scritte vicino al timbro "SI ACCETTA CON RISERVA" (es. "13.02.26"): sono la data di ricevimento, NON una scadenza.
- NON sono righe articolo: "Reso C/Lavorazione...", "Vs. DDT n. ...", bancali/epal, pesi, "HS Code", righe di trasporto. Estrai solo i prodotti con quantità.
- Le pagine che non contengono un DDT (retro con sole condizioni di vendita, pagine vuote) non vanno estratte.
- Per ogni riga inserisci in 'campi_incerti' i nomi dei campi di cui non sei sicuro (es. ["data_scadenza"]), soprattutto per le scritte a mano.`;

const str = { type: Type.STRING, nullable: true };

const RIGA = {
  type: Type.OBJECT,
  properties: {
    codice_articolo: str,
    descrizione: str,
    quantita: { type: Type.NUMBER, nullable: true },
    unita_misura: str,
    lotto: str,
    data_scadenza: str,
    campi_incerti: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

const DDT = {
  type: Type.OBJECT,
  properties: {
    fornitore: str,
    partita_iva_fornitore: str,
    cliente: str,
    numero_ddt: str,
    data_ddt: str,
    numero_ordine_cliente: str,
    causale_trasporto: str,
    pagina_inizio: { type: Type.INTEGER },
    righe: { type: Type.ARRAY, items: RIGA },
  },
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: { documenti: { type: Type.ARRAY, items: DDT } },
};

const MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/** @returns {Promise<import('zod').infer<typeof EstrazioneSchema>['documenti']>} lista di DDT (può essere vuota) */
export async function extractDdt(filePath) {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY non impostata (vedi .env.example)');
  }
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const mimeType = MIME[path.extname(filePath).toLowerCase()] || 'application/pdf';
  const data = fs.readFileSync(filePath).toString('base64');

  const resp = await ai.models.generateContent({
    model: config.geminiModel,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data } }, { text: PROMPT }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
  });
  return EstrazioneSchema.parse(JSON.parse(resp.text)).documenti;
}

// Oggetto sostituibile nei test (mock) senza toccare il resto del codice.
export const extractor = { extractDdt };