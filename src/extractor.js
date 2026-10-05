// Lettura del DDT con Gemini (PDF o immagine -> JSON strutturato).
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import { config } from './config.js';
import { DdtSchema } from './schemas.js';

const PROMPT = `Sei un addetto di magazzino che registra merce in ingresso per un'azienda alimentare.
Leggi il DDT (documento di trasporto) allegato ed estrai i dati richiesti.

Regole:
- NON inventare nulla. Se un dato non è presente o non è leggibile, usa null.
- Lotto e data di scadenza possono essere annotati A MANO sul documento: leggili comunque.
- Le date vanno in formato ISO YYYY-MM-DD (le date italiane sono GG/MM/AAAA).
- Una riga per ogni articolo. Le quantità sono numeri (usa il punto come separatore decimale).
- Per ogni riga inserisci in 'campi_incerti' i nomi dei campi di cui non sei sicuro
  (es. ["lotto", "data_scadenza"]).
- 'partita_iva_fornitore': solo le 11 cifre della P.IVA di chi emette il DDT, senza prefisso IT.
- 'cliente' è il destinatario della merce; 'fornitore' è chi emette il DDT.`;

const str = { type: Type.STRING, nullable: true };

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fornitore: str,
    partita_iva_fornitore: str,
    cliente: str,
    numero_ddt: str,
    data_ddt: str,
    numero_ordine_cliente: str,
    righe: {
      type: Type.ARRAY,
      items: {
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
      },
    },
  },
};

const MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

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
  return DdtSchema.parse(JSON.parse(resp.text));
}

// Oggetto sostituibile nei test (mock) senza toccare il resto del codice.
export const extractor = { extractDdt };
