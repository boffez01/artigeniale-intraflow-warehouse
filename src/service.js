// Logica applicativa: acquisizione (file -> estrazione -> controlli -> DB) e invio a Giobby.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as db from './db.js';
import { extractor } from './extractor.js';
import { fileCompleto } from './filecheck.js';
import { getGiobbyClient } from './giobby.js';
import { emptyDdt } from './schemas.js';
import { check, metaDdt, normalize } from './validation.js';

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const TUTTI = Number.MAX_SAFE_INTEGER; // nuovo documento: confronta con TUTTI i precedenti

/** Valutazione completa: regole sul documento + controlli di duplicato sul DB. UNICO punto che chiama check(). */
export function valuta(ddt, id = TUTTI) {
  const meta = metaDdt(ddt);
  const esito = check(ddt, {
    duplicato: meta.chiave_ddt ? db.findDuplicato(meta.chiave_ddt, id) : null,
    simili: meta.numero_ddt && meta.data_ddt ? db.findStessoNumero(meta.numero_ddt, meta.data_ddt, meta.chiave_ddt, id) : [],
  });
  return { meta, esito };
}

/**
 * Acquisisce un file: può contenere più DDT, ognuno diventa una scheda.
 * @returns {{ids:number[], id:number, duplicato:boolean}|null}
 */
export async function ingest(filePath) {
  if (!fs.existsSync(filePath)) return null;

  // Idempotenza 1: stessa scansione (stessi byte) già acquisita -> niente Gemini, niente nuove righe.
  const fileHash = sha256(filePath);
  const gia = db.findByHash(fileHash);
  if (gia.length) {
    fs.rmSync(filePath, { force: true });
    return { ids: gia.map((r) => r.id), id: gia[0].id, duplicato: true };
  }

  const { name, ext } = path.parse(filePath);
  const dest = path.join(config.archiveDir, `${name}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
  try {
    fs.renameSync(filePath, dest);
  } catch (e) {
    if (e.code === 'ENOENT') return null; // già preso da un altro processo
    throw e;
  }

  let documenti = [];
  let errore = null;
  if (!fileCompleto(dest)) {
    errore = 'File incompleto o corrotto (PDF troncato?): rifai la scansione';
  } else {
    try {
      const out = await extractor.extractDdt(dest);
      documenti = (Array.isArray(out) ? out : [out]).map(normalize);
      if (!documenti.length) errore = 'Nessun DDT riconosciuto nel file';
    } catch (e) {
      errore = String(e.message || e);
    }
  }

  const base = path.basename(filePath);
  let ids;
  try {
    // Tutti i DDT del file in UNA transazione: o entrano tutti o nessuno (es. due upload identici in contemporanea).
    ids = db.tx(() => {
      if (errore) {
        return [db.insert({ filename: base, storedPath: dest, status: 'errore', payload: emptyDdt(), error: errore, fileHash, indiceDoc: 0, pagina: 1 })];
      }
      return documenti.map((ddt, i) => {
        const { meta, esito } = valuta(ddt); // vede anche i DDT già inseriti da questo stesso file
        return db.insert({
          filename: documenti.length > 1 ? `${base} (DDT ${i + 1}/${documenti.length})` : base,
          storedPath: dest, status: 'da_verificare', payload: ddt, warnings: esito,
          fileHash, indiceDoc: i, pagina: ddt.pagina_inizio || 1, meta,
        });
      });
    });
  } catch (e) {
    if (!db.isUnique(e)) throw e;
    // Un altro processo ha acquisito lo stesso file nel frattempo: tengo le sue schede, scarto la mia copia.
    fs.rmSync(dest, { force: true });
    const altri = db.findByHash(fileHash);
    if (!altri.length) throw e;
    return { ids: altri.map((r) => r.id), id: altri[0].id, duplicato: true };
  }
  return { ids, id: ids[0], duplicato: false };
}

/**
 * Salva le modifiche dell'utente. Il payload arriva dal browser: viene SEMPRE rivalidato qui.
 * @param ddt DDT già passato da DdtSchema.parse + normalize
 */
export function salva(row, ddt) {
  const { meta, esito } = valuta(ddt, row.id);
  db.update(row.id, { payload: ddt, warnings: esito, ...meta });
  return esito;
}

/**
 * Salva + valida + (se non ci sono errori) prenota l'invio in modo atomico + invia a Giobby.
 * Chiunque voglia caricare un DDT passa da qui: nessuna scorciatoia verso Giobby.
 */
export async function confermaEInvia(row, ddt) {
  const esito = salva(row, ddt);
  if (esito.errori.length) return { ok: false, esito };

  const { chiave_ddt: chiave } = metaDdt(ddt);
  if (!db.claimInvio(row.id, chiave)) {
    return { ok: false, esito: { errori: ['DDT già in invio o già caricato'], avvisi: esito.avvisi } };
  }
  try {
    const ref = await getGiobbyClient().registraCarico(ddt, { chiave });
    db.update(row.id, { status: 'caricato', giobby_ref: ref, error: null });
    return { ok: true, esito };
  } catch (e) {
    db.update(row.id, { status: 'errore', error: String(e.message || e) }); // libera la chiave: si può riprovare
    return { ok: false, esito };
  }
}

export function scarta(row) {
  if (!['da_verificare', 'errore'].includes(row.status)) return false;
  db.update(row.id, { status: 'scartato' });
  return true;
}