// Logica applicativa: acquisizione (file -> estrazione -> controlli -> DB) e invio a Giobby.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as db from './db.js';
import { extractor } from './extractor.js';
import { fileCompleto } from './filecheck.js';
import { getGiobbyClient } from './giobby.js';
import { dataGiobby, oggiIso } from './giobbyCarico.js';
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
    aggiornaConsegne(db.get(row.id)).catch(() => {}); // in secondo piano, senza far aspettare chi conferma: etichetta "Consegna parziale" in archivio (e delle schede sullo stesso ordine)
    return { ok: true, esito };
  } catch (e) {
    db.update(row.id, { status: 'errore', error: String(e.message || e) }); // libera la chiave: si può riprovare
    return { ok: false, esito };
  }
}

const inAggiornamento = new Set(); // evita due modifiche contemporanee sullo stesso DDT (doppio clic)

/**
 * Modifica di un DDT già caricato: validazione completa, poi aggiornamento dell'Entrata Merci in Giobby.
 * Il DB cambia SOLO se Giobby ha accettato la modifica: così scheda e gestionale non divergono.
 * @returns {{ok:true, esito:object}|{ok:false, errori?:string[], errore?:string}}
 */
export async function aggiornaCaricato(row, ddt) {
  if (row.status !== 'caricato') return { ok: false, errore: 'Il DDT non è ancora caricato su Giobby' };
  const { meta, esito } = valuta(ddt, row.id);
  if (esito.errori.length) return { ok: false, errori: esito.errori };
  if (meta.chiave_ddt && db.findAltroCaricato(meta.chiave_ddt, row.id)) {
    return { ok: false, errori: ['Esiste già un altro DDT caricato con questo fornitore, numero e data'] };
  }
  if (inAggiornamento.has(row.id)) return { ok: false, errore: 'Aggiornamento già in corso' };
  inAggiornamento.add(row.id);
  try {
    const out = await getGiobbyClient().aggiornaCarico(ddt, { riferimento: row.giobby_ref, precedente: row.payload });
    const finale = { errori: [], avvisi: [...esito.avvisi, ...out.avvisi] };
    db.update(row.id, { payload: ddt, warnings: finale, ...meta, giobby_ref: out.riferimento ?? row.giobby_ref, error: null });
    aggiornaConsegne(db.get(row.id)).catch(() => {}); // le quantità sono cambiate: l'etichetta in archivio si ricalcola
    return { ok: true, esito: finale };
  } catch (e) {
    return { ok: false, errore: String(e.message || e) }; // il DDT resta com'era: Giobby non è stato toccato (o non del tutto)
  } finally {
    inAggiornamento.delete(row.id);
  }
}

/** Etichetta per l'archivio: parziale (manca qualcosa, ordine aperto) | chiusa (resto in un nuovo ordine) | completa. */
export const statoConsegna = (info) => (info ? (!info.mancaQualcosa ? 'completa' : info.aperto ? 'parziale' : 'chiusa') : null);

/** Cosa manca all'ordine del carico (null in simulazione: senza Giobby non ci sono ordini). Aggiorna anche l'etichetta in archivio. */
export async function residuoCaricato(row) {
  const info = await getGiobbyClient().residuoDelCarico(row.giobby_ref);
  const stato = statoConsegna(info);
  if (stato && stato !== row.consegna) db.update(row.id, { consegna: stato });
  return info;
}

const cifreOrdine = (t) => /\d+/.exec(String(t ?? ''))?.[0] ?? null;

/**
 * Ricontrolla su Giobby la consegna di un DDT e dei DDT "aperti" che citano lo stesso ordine
 * (un nuovo carico può aver completato un ordine che prima era parziale). Mai bloccante: gli errori di Giobby si ignorano.
 */
export async function aggiornaConsegne(row) {
  const n = cifreOrdine(row.payload?.numero_ordine_cliente);
  const altri = db.caricatiDaRicontrollare().filter((r) => r.id !== row.id && n && cifreOrdine(r.payload?.numero_ordine_cliente) === n);
  for (const r of [db.get(row.id), ...altri]) {
    try { await residuoCaricato(r); } catch { /* resta com'era: si ricontrolla alla prossima occasione */ }
  }
}

/** All'avvio: i DDT già caricati senza etichetta (caricati prima di questa funzione, o con Giobby non raggiungibile). */
export async function aggiornaTutteLeConsegne() {
  for (const r of db.caricatiDaRicontrollare()) {
    try { await residuoCaricato(r); } catch { /* si riprova al prossimo avvio */ }
  }
}

const inChiusura = new Set(); // evita due chiusure dello stesso ordine (doppio clic): si creerebbero due ordini per il resto

/**
 * Il resto della consegna non arriva più: chiude l'ordine e ne crea uno nuovo con quello che manca.
 * @param consegna data di consegna prevista del nuovo ordine, AAAA-MM-GG
 * @returns {{ok:true, esito:object}|{ok:false, errore:string, tipo:'dati'|'giobby'}}
 */
export async function chiudiResiduo(row, consegna) {
  if (row.status !== 'caricato') return { ok: false, tipo: 'dati', errore: 'Il DDT non è ancora caricato su Giobby' };
  if (dataGiobby(consegna) == null) return { ok: false, tipo: 'dati', errore: 'Indica una data di consegna valida' };
  if (consegna < oggiIso()) return { ok: false, tipo: 'dati', errore: 'La data di consegna non può essere nel passato' };
  if (inChiusura.has(row.id)) return { ok: false, tipo: 'dati', errore: 'Operazione già in corso' };
  inChiusura.add(row.id);
  try {
    const esito = await getGiobbyClient().chiudiOrdineConResiduo(row.giobby_ref, { consegna });
    await aggiornaConsegne(db.get(row.id));
    return { ok: true, esito };
  } catch (e) {
    return { ok: false, tipo: 'giobby', errore: String(e.message || e) };
  } finally {
    inChiusura.delete(row.id);
  }
}

export function scarta(row) {
  if (!['da_verificare', 'errore'].includes(row.status)) return false;
  db.update(row.id, { status: 'scartato' });
  return true;
}