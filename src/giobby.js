// Client Giobby.
// DryRun: scrive il payload in data/outbox (sviluppo e collaudo senza toccare il gestionale).
// ApiGiobby: carico merci vero su Giobby (GIOBBY_MODE=api).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { catalogo, conCodiciGiobby, righeDaScegliere, risolviArticoli } from './articoli.js';
import { adattaEntrataMerci, calcolaResiduo, corpoOrdineResiduo, corpoOrdineVendita, corpoPerAggiornamento, righeOrdineSpezzate, umDecimale, dataGiobby, giacenzeDaReport, numeroOrdine, oggiIso, isoDaGiobby, ordineVenditaPerPicking, provinciaDa, ricevutoPerOrdine, rigaEvasa } from './giobbyCarico.js';
import { GiobbyError, GiobbyHttp } from './giobbyHttp.js';

// Giacenze di prova (stessi articoli del sandbox Giobby) per vedere il picking senza collegamento a Giobby.
const GIACENZE_PROVA = [
  { articolo: 'FAR-002', lotto: 'L2612A', scadenza: '2027-12-31', ubicazione: 'A-01-02', magazzino: 'MB', disponibile: 40 },
  { articolo: 'FAR-002', lotto: 'L2612C', scadenza: '2027-03-31', ubicazione: 'B-02-01', magazzino: 'MB', disponibile: 25 },
  { articolo: 'FAR-002', lotto: 'L2609Z', scadenza: '2026-09-30', ubicazione: 'A-01-01', magazzino: 'MB', disponibile: 50 },
  { articolo: 'FAR-003', lotto: 'L2612B', scadenza: '2028-06-30', ubicazione: 'A-01-10', magazzino: 'MB', disponibile: 20 },
];

// Ordini di vendita di prova (stessi dell'esempio della pagina Picking).
const ORDINI_PROVA = [
  { id: 'OV-101', idGiobby: null, cliente: 'Panificio Rossi', provincia: 'BS', stato: 'Creato', consegna: '2026-10-15', righe: [{ articolo: 'FAR-002', descrizione: 'Farina di mais 1 kg', quantita: 50 }, { articolo: 'FAR-003', descrizione: 'Semola 1 kg', quantita: 10 }] },
  { id: 'OV-102', idGiobby: null, cliente: 'Pasta Bianchi', provincia: 'BG', stato: 'Creato', consegna: '2026-10-14', righe: [{ articolo: 'FAR-002', descrizione: 'Farina di mais 1 kg', quantita: 30 }, { articolo: 'FAR-001', descrizione: 'Farina 00 1 kg', quantita: 5 }] },
  { id: 'OV-103', idGiobby: null, cliente: 'Panificio Rossi', provincia: 'BS', stato: 'Creato', consegna: '2026-10-16', righe: [{ articolo: 'FAR-003', descrizione: 'Semola 1 kg', quantita: 5 }] },
];

class DryRunGiobby {
  async prodotti() { return null; } // senza collegamento a Giobby non c'è un catalogo con cui abbinare
  /** Senza collegamento a Giobby: giacenze di prova. */
  async giacenze() { return GIACENZE_PROVA.map((g) => ({ ...g })); }
  /** Senza collegamento a Giobby: ordini di vendita di prova. */
  async emettiDdtUscita(idGiobby, prelievi, { parziale = false } = {}) {
    if (!prelievi?.length) throw new Error('Nessun prelievo da registrare');
    return { idDdt: null, riferimento: `DDT di uscita SIMULATO (ordine ${idGiobby}): nulla è stato scritto in Giobby`, statoOrdine: null, avvisi: [] };
  }
  async pdfDdtUscita() { throw new Error('Il PDF del DDT si scarica solo con il collegamento a Giobby (GIOBBY_MODE=api)'); }
  async ordiniEvasi() {
    return [
      { id: 'OV-090', idGiobby: null, cliente: 'Panificio Rossi', provincia: 'BS', stato: 'Merce spedita', data: '2026-10-12' },
      { id: 'OV-091', idGiobby: null, cliente: 'Pasta Bianchi', provincia: 'BG', stato: 'Merce spedita', data: '2026-10-13' },
    ];
  }
  async ordiniVendita() { return ORDINI_PROVA.map((o) => ({ ...o, righe: o.righe.map((r) => ({ ...r })) })); }
  async registraCarico(ddt, { chiave } = {}) {
    const ref = `DRY-${new Date().toISOString().replace(/\D/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(path.join(config.outboxDir, `${ref}.json`), JSON.stringify({ chiave, ...ddt }, null, 2));
    return ref;
  }
  /** Modifica di un DDT già caricato: in simulazione scrive la nuova versione in outbox, il riferimento resta lo stesso. */
  async aggiornaCarico(ddt, { riferimento } = {}) {
    const nome = `${riferimento || 'DRY'}.agg-${new Date().toISOString().replace(/\D/g, '')}.json`.replace(/[^\w.-]/g, '_');
    fs.writeFileSync(path.join(config.outboxDir, nome), JSON.stringify({ aggiornamento: riferimento, ...ddt }, null, 2));
    return { riferimento: riferimento || null, avvisi: [] };
  }
  /** Senza collegamento a Giobby non ci sono ordini da leggere né da chiudere. */
  async residuoDelCarico() { return null; }
  async chiudiOrdineConResiduo() { throw new Error('Disponibile solo con il collegamento a Giobby (GIOBBY_MODE=api)'); }
}

const STATI_ORDINE_APERTO = ['CREATED', 'GOOD_PARTIAL_RECEIVED'];
// Ordini di vendita ancora da evadere: creati o parzialmente evasi (gli altri stati, es. evaso/chiuso, si ignorano).
const venditaAperta = (stato) => stato === 'CREATED' || /PARTIAL/i.test(String(stato ?? ''));
const cifre = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * Carico su Giobby, provato sul sandbox:
 *  1. trova l'ordine di acquisto (numero_ordine_cliente del DDT + fornitore)
 *  2. crea l'Entrata Merci DALL'ORDINE (così Giobby aggiorna lo stato dell'ordine) con il numero del DDT del fornitore
 *  3. crea i lotti che non esistono
 *  4. corregge l'Entrata Merci con quello che dice il DDT: quantità, lotti, righe non consegnate tolte
 *     -> l'ordine passa a "Merce ricevuta" o "parzialmente ricevuta"
 * Idempotente: se esiste già un'Entrata Merci di quel fornitore con quel numero DDT, non ne crea un'altra
 * e rifà solo la correzione (utile se il tentativo precedente si è interrotto a metà).
 * Qualsiasi dubbio (ordine non trovato, più ordini, articolo non abbinato) = errore, mai un carico approssimato.
 */
export class ApiGiobby {
  constructor(http = new GiobbyHttp(), { magazzino = config.giobbyStorage || 'MB', oggi = () => oggiIso() } = {}) {
    this.http = http;
    this.magazzino = magazzino;
    this.oggi = oggi;
  }

  #ordiniCache = null;

  async #elenco(percorso, chiaveRisposta) {
    const tutti = [];
    for (let offset = 0; offset < 5000;) {
      const r = await this.http.get(percorso, offset ? { offset: String(offset) } : undefined);
      const pagina = r?.[chiaveRisposta] ?? [];
      tutti.push(...pagina);
      offset += pagina.length;
      if (!pagina.length || offset >= (r?.metadata?.totalCount ?? 0)) break;
    }
    return tutti;
  }

  /**
   * Giacenze DISPONIBILI per articolo e lotto (già al netto della merce impegnata da altri ordini di vendita), con la scadenza del lotto.
   * Giobby divide per lotto solo con lotsDetail=true. @param magazzino es. 'MB': solo quel magazzino (vuoto = tutti)
   */
  async giacenze({ magazzino = null } = {}) {
    const report = [];
    for (let offset = 0; offset < 20000;) {
      const query = { lotsDetail: 'true', storageDetail: 'true', ...(magazzino ? { idStorage: magazzino } : {}), ...(offset ? { offset: String(offset) } : {}) };
      const r = await this.http.get('/stocks/avaibility/report', query);
      const pagina = r?.stockReports ?? [];
      report.push(...pagina);
      offset += pagina.length;
      if (!pagina.length || offset >= (r?.metadata?.totalCount ?? 0)) break;
    }
    return giacenzeDaReport(report, await this.#elenco('/lots', 'lots'));
  }

  /**
   * Ordini di vendita da evadere, pronti per il picking. L'elenco di Giobby non ha le righe: si legge il dettaglio di ogni ordine aperto.
   * Ordinati per data di consegna (poi per numero). Attenzione: di un ordine già evaso in parte si legge la quantità ordinata intera.
   */
  /** Ordini di vendita già usciti (non più aperti): solo l'elenco di Giobby, senza dettaglio (veloce). Ultimi 100. */
  async ordiniEvasi() {
    const chiusi = (await this.#elenco('/sales/orders', 'documentsHeaders')).filter((o) => !venditaAperta(o.docStatus));
    return chiusi.sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 100).map((o) => ({
      id: `ODV ${String(o.docNumber ?? o.id).trim()}`, idGiobby: o.id, cliente: o.companyName || o.idCustomer || null, provincia: provinciaDa(o),
      stato: o.docStatusDesc || o.docStatus || null, data: o.docDate ? isoDaGiobby(Number(o.docDate)) : null,
    }));
  }

  #province = new Map();
  /** Provincia dell'anagrafica cliente (se Giobby la espone); un solo tentativo per cliente, mai bloccante. */
  async #provinciaCliente(idCliente) {
    const k = String(idCliente);
    if (!this.#province.has(k)) {
      let p = null;
      try {
        const r = await this.http.get(`/customers/${encodeURIComponent(k)}`);
        p = provinciaDa(r?.customer ?? r?.document ?? r);
      } catch { /* provincia non disponibile: la colonna resta vuota */ }
      this.#province.set(k, p);
    }
    return this.#province.get(k);
  }

  async ordiniVendita() {
    const aperti = (await this.#elenco('/sales/orders', 'documentsHeaders')).filter((o) => venditaAperta(o.docStatus));
    const ordini = [];
    for (const o of aperti) {
      const { document } = await this.http.get(`/sales/${o.id}/orders`);
      const ordine = ordineVenditaPerPicking(document);
      if (!ordine.provincia && ordine.idCliente) ordine.provincia = await this.#provinciaCliente(ordine.idCliente);
      if (ordine.righe.length) ordini.push(ordine);
    }
    return ordini.sort((a, b) => String(a.consegna ?? '9999').localeCompare(String(b.consegna ?? '9999')) || Number(a.idGiobby) - Number(b.idGiobby));
  }

  /**
   * DDT in uscita da un ordine di vendita, con i lotti scelti (per lotto, come dal picking e dalle correzioni del back office).
   * Giobby aggancia il DDT all'ordine solo se nasce dall'ordine, e assegna un lotto solo per riga: quindi
   *  1) la riga dell'ordine si spezza in una riga per lotto  2) il DDT si crea dall'ordine  3) i lotti si scrivono riga per riga.
   * Se qualcosa si ferma a metà, il DDT creato si cancella e l'ordine torna com'era. @param prelievi [{ articolo, lotto, scadenza, quantita }]
   */
  async emettiDdtUscita(idGiobby, prelievi, { parziale = false } = {}) {
    const id = Number(idGiobby);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Ordine non valido');
    const validi = (prelievi ?? []).filter((p) => p?.articolo && Number(p.quantita) > 0);
    if (!validi.length) throw new Error('Nessun prelievo da registrare');
    for (const p of validi) if (p.lotto && !p.scadenza) throw new Error(`${p.articolo}: il lotto ${p.lotto} non ha la scadenza`);

    const { document: originale } = await this.http.get(`/sales/${id}/orders`);
    if (originale.docStatus !== 'CREATED' && !/PARTIAL/i.test(String(originale.docStatus))) throw new Error(`L'ordine ${originale.docDescription} è "${originale.docStatusDesc}": il DDT si emette solo per un ordine "Creato" o già spedito in parte`);
    await this.#controllaPrelievi(originale, validi, { parziale });
    const righeOrdine = righeOrdineSpezzate(originale.rows, validi); // errore qui = ancora nulla scritto

    let idDdt = null;
    let ordineModificato = false;
    try {
      await this.http.richiesta('PUT', `/sales/${id}/orders`, { body: corpoOrdineVendita(originale, righeOrdine) });
      ordineModificato = true;
      const r = await this.http.post(`/sales/${id}/orderstogoodsissue`, { idNumerator: '1', docDate: String(dataGiobby(this.oggi())), idDocumentTypeExt: '0' });
      if (!r?.idDocument) throw new Error('Giobby non ha restituito l\'id del DDT creato');
      idDdt = r.idDocument;
      const { document: ddtGiobby } = await this.http.get(`/sales/${idDdt}/goodsissue`);
      const { documento: nuovo, avvisi } = adattaEntrataMerci(ddtGiobby, { righe: validi.map((p) => ({ codice_articolo: p.articolo, quantita: p.quantita, lotto: p.lotto, data_scadenza: p.scadenza })) });
      const corpo = corpoPerAggiornamento(nuovo);
      // il riferimento all'ordine (che tiene collegata la riga) non è nei campi scrivibili standard: si rimette a mano
      corpo.rows.forEach((riga, i) => {
        if (nuovo.rows[i]?.saleorderref != null) riga.saleorderref = nuovo.rows[i].saleorderref;
        if (nuovo.rows[i]?.saleorderposref != null) riga.saleorderposref = nuovo.rows[i].saleorderposref;
      });
      await this.http.richiesta('PUT', `/sales/${idDdt}/goodsissue`, { body: corpo });
      const { document: dopo } = await this.http.get(`/sales/${id}/orders`);
      return { idDdt, riferimento: ddtGiobby.docDescription, statoOrdine: dopo.docStatusDesc, avvisi };
    } catch (e) {
      const problemi = [];
      if (idDdt) { try { await this.http.richiesta('DELETE', `/sales/${idDdt}/goodsissue`); } catch { problemi.push(`DDT ${idDdt} da cancellare a mano in Giobby`); } }
      if (ordineModificato) {
        try {
          const { document: attuale } = await this.http.get(`/sales/${id}/orders`);
          await this.http.richiesta('PUT', `/sales/${id}/orders`, { body: corpoOrdineVendita(attuale, originale.rows) });
        } catch { problemi.push(`righe dell'ordine ${originale.docDescription} da controllare in Giobby (erano spezzate per lotto)`); }
      }
      if (problemi.length) e.message = `${e.message} — ATTENZIONE: ${problemi.join('; ')}`;
      throw e;
    }
  }

  /** Paletti prima di scrivere in Giobby: solo articoli dell'ordine, quantità valide, lotti esistenti non scaduti e con giacenza (riletta ora). */
  async #controllaPrelievi(ordine, prelievi, { parziale }) {
    const n = (x) => String(x ?? '').trim().toUpperCase();
    const merce = ordine.rows.filter((r) => Number(r.idPosType) === 1 && r.idMaterial && !rigaEvasa(r));
    const ordinato = new Map();
    for (const r of merce) {
      const o = ordinato.get(n(r.idMaterial)) ?? { quantita: 0, um: r.um };
      o.quantita += Number(r.quantity) || 0;
      ordinato.set(n(r.idMaterial), o);
    }
    const visti = new Set();
    for (const p of prelievi) {
      const art = n(p.articolo);
      const o = ordinato.get(art);
      if (!o) throw new Error(`${art} non è nell'ordine ${ordine.docDescription}: non si possono aggiungere prodotti al DDT`);
      const q = Number(p.quantita);
      if (!Number.isFinite(q) || q <= 0) throw new Error(`${art}: quantità non valida`);
      if (!umDecimale(o.um) && !Number.isInteger(q)) throw new Error(`${art}: la quantità deve essere un numero intero (unità ${o.um})`);
      const chiave = `${art}|${n(p.lotto)}`;
      if (visti.has(chiave)) throw new Error(`${art}: il lotto ${p.lotto || '(senza lotto)'} è indicato due volte`);
      visti.add(chiave);
    }
    const conLotto = prelievi.filter((p) => p.lotto);
    if (conLotto.length) {
      const giac = await this.giacenze();
      for (const p of conLotto) {
        const g = giac.find((x) => n(x.articolo) === n(p.articolo) && n(x.lotto) === n(p.lotto));
        if (!g) throw new Error(`${p.articolo}: il lotto ${p.lotto} non risulta in magazzino`);
        if (g.scadenza && g.scadenza < this.oggi()) throw new Error(`${p.articolo}: il lotto ${p.lotto} è scaduto il ${g.scadenza}`);
        if (Number(p.quantita) > g.disponibile + 1e-9) throw new Error(`${p.articolo} lotto ${p.lotto}: ne indichi ${p.quantita} ma in magazzino ce ne sono ${g.disponibile} (la giacenza è cambiata?)`);
      }
    }
    const mancanti = [];
    for (const [art, o] of ordinato) {
      const preso = prelievi.filter((p) => n(p.articolo) === art).reduce((t, p) => t + Number(p.quantita), 0);
      if (preso < o.quantita - 1e-9) mancanti.push(`${art} ${Math.round(preso * 1000) / 1000}/${o.quantita}`);
    }
    if (mancanti.length && !parziale) throw new Error(`Consegna parziale (${mancanti.join(', ')}): conferma che il resto resta da evadere`);
  }

  /** PDF del DDT di uscita, come lo stampa Giobby. @returns {Promise<Buffer>} */
  async pdfDdtUscita(idDdt) {
    const id = Number(idDdt);
    if (!Number.isInteger(id) || id <= 0) throw new Error('DDT non valido');
    const { buffer } = await this.http.scarica(`/sales/goodsissue/${id}/pdf`, { idDocType: '1' });
    if (buffer.subarray(0, 4).toString() !== '%PDF') throw new Error('Giobby non ha restituito un PDF');
    return buffer;
  }

  /** Catalogo articoli di Giobby: [{ id, codice (secondario), descrizione, um }]. */
  async prodotti() {
    return catalogo(await this.#elenco('/products', 'products'));
  }

  /**
   * Ordini che raccolgono il resto di `ordine` (hanno "ODA n" nei riferimenti interni).
   * L'elenco ordini di Giobby NON riporta i riferimenti interni (internalNote arriva vuoto): si leggono dal dettaglio
   * di ogni ordine più recente dello stesso fornitore.
   */
  async #ordiniDelResto(ordine, tutti) {
    const numero = String(Number(cifre(ordine.docNumber)));
    const figli = [];
    for (const o of tutti) {
      if (o.id === ordine.id || String(o.idVendor) !== String(ordine.idVendor)) continue;
      if (Number(o.createDate) < Number(ordine.createDate)) continue;
      const nota = o.internalNote || (await this.http.get(`/purchases/${o.id}/orders`))?.document?.internalNote;
      if (numeroOrdine(nota) === numero) figli.push(o);
    }
    return figli;
  }

  async trovaOrdine(ddt) {
    const numeri = new Set((String(ddt.numero_ordine_cliente ?? '').match(/\d+/g) || []).map((n) => String(Number(n))));
    if (!numeri.size) throw new Error('Il DDT non riporta un numero d\'ordine: non so a quale ordine di Giobby agganciare il carico');
    const piva = cifre(ddt.partita_iva_fornitore);
    this.#ordiniCache = await this.#elenco('/purchases/orders', 'documentsHeaders');
    const candidati = this.#ordiniCache.filter((o) => {
      if (!numeri.has(String(Number(cifre(o.docNumber))))) return false;
      const pivaOrdine = cifre(o.vendorData?.vatcode);
      return !piva || !pivaOrdine || piva === pivaOrdine;
    });
    if (!candidati.length) throw new Error(`Ordine "${ddt.numero_ordine_cliente}" non trovato in Giobby per questo fornitore`);
    if (candidati.length > 1) throw new Error(`Più ordini in Giobby corrispondono a "${ddt.numero_ordine_cliente}" (${candidati.map((o) => o.docDescription).join(', ')}): scegli a mano`);
    let ordine = candidati[0];
    // Ordine chiuso perché il resto arriverà più tardi: il resto è in un nuovo ordine che porta "ODA n" nei riferimenti interni.
    const tutti = this.#ordiniCache ?? [];
    for (let salti = 0; !STATI_ORDINE_APERTO.includes(ordine.docStatus) && salti < 5; salti++) {
      const figli = await this.#ordiniDelResto(ordine, tutti);
      // se il resto è già in un ordine aperto, quello; se anche quello è stato chiuso a sua volta, si prosegue lungo la catena
      const successore = figli.find((o) => STATI_ORDINE_APERTO.includes(o.docStatus)) ?? figli.sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (!successore) break;
      ordine = successore;
    }
    if (!STATI_ORDINE_APERTO.includes(ordine.docStatus)) {
      throw new Error(`L'ordine ${ordine.docDescription} è già "${ordine.docStatusDesc || ordine.docStatus}": non carico altra merce`);
    }
    return ordine;
  }

  /** Crea i lotti che non esistono. Ritorna gli avvisi (es. lotto già in Giobby con una scadenza diversa da quella del DDT). */
  async #assicuraLotti(righeDdt, ddt) {
    const avvisi = [];
    for (const r of righeDdt) {
      const lotto = String(r.lotto ?? '').trim();
      if (!lotto || !r.codice_articolo) continue;
      let esistente = null;
      try {
        const risposta = await this.http.get(`/lots/${encodeURIComponent(lotto)}`);
        esistente = risposta?.lot ?? risposta?.lots?.[0] ?? risposta;
      } catch (e) {
        if (!(e instanceof GiobbyError) || ![400, 404].includes(e.status)) throw e; // lotto inesistente: lo creiamo
      }
      if (esistente?.idLot || esistente?.idMaterial) {
        const articolo = esistente.idMaterial;
        if (articolo && String(articolo).toUpperCase() !== String(r.codice_articolo).trim().toUpperCase()) {
          throw new Error(`Il lotto ${lotto} esiste già in Giobby per un altro articolo (${articolo}): non lo riuso`);
        }
        const scadenzaGiobby = Number(esistente.expireDate);
        const scadenzaDdt = dataGiobby(r.data_scadenza);
        if (Number.isFinite(scadenzaGiobby) && scadenzaDdt != null && scadenzaGiobby !== scadenzaDdt) {
          avvisi.push(`Il lotto ${lotto} esiste già in Giobby con una scadenza diversa da quella del DDT: la scadenza del lotto non è stata cambiata (correggila in Giobby)`);
        }
        continue;
      }
      const scadenza = dataGiobby(r.data_scadenza);
      if (scadenza == null) throw new Error(`Lotto ${lotto} (${r.codice_articolo}): scadenza mancante o non valida`);
      await this.http.post('/lots', {
        idLot: lotto,
        idMaterial: String(r.codice_articolo).trim(),
        incomingDate: dataGiobby(this.oggi()),
        expireDate: scadenza,
        reference: ddt.fornitore || '',
      });
    }
    return avvisi;
  }

  async registraCarico(ddtOriginale, { chiave } = {}) {
    const numeroDdt = String(ddtOriginale.numero_ddt ?? '').trim();
    if (!numeroDdt) throw new Error('Numero DDT mancante');
    const ordine = await this.trovaOrdine(ddtOriginale);

    // codici del fornitore -> codici di Giobby (prima di scrivere qualsiasi cosa)
    const risoluzioni = risolviArticoli(ddtOriginale.righe, await this.prodotti());
    const daScegliere = righeDaScegliere(ddtOriginale.righe, risoluzioni);
    if (daScegliere) throw new Error(daScegliere);
    const ddt = conCodiciGiobby(ddtOriginale, risoluzioni);

    const giaPresenti = await this.#elenco('/purchases/goodsreceipt', 'documentsHeaders');
    let em = giaPresenti.find((d) => String(d.docNumber) === numeroDdt && String(d.idVendor) === String(ordine.idVendor));
    let creataOra = false;
    if (!em) {
      const r = await this.http.post(`/purchases/${ordine.id}/orderstogoodsreceipt`, {
        idNumerator: '1',
        docNumber: numeroDdt,
        docDate: String(dataGiobby(this.oggi())),
        idDocumentTypeExt: '0',
        destIdStorage: this.magazzino,
      });
      if (!r?.idDocument) throw new Error('Giobby non ha restituito l\'id dell\'Entrata Merci creata');
      em = { id: r.idDocument };
      creataOra = true;
    }

    try {
      const { document: documento } = await this.http.get(`/purchases/${em.id}/goodsreceipt`);
      const { documento: nuovo, avvisi, nonCaricate } = adattaEntrataMerci(documento, ddt);
      if (nonCaricate.length) throw new Error(`Articoli del DDT non presenti nell'ordine ${ordine.docDescription}: ${nonCaricate.join(', ')} (controlla i codici articolo)`);
      if (!nuovo.rows.some((r) => r.idPosType === 1)) throw new Error('Nessuna riga del DDT corrisponde all\'ordine');

      await this.#assicuraLotti(ddt.righe, ddt);
      nuovo.note = [nuovo.note, `DDT fornitore n. ${numeroDdt} del ${ddt.data_ddt || '?'}`].filter(Boolean).join(' - ').slice(0, 250);
      await this.http.richiesta('PUT', `/purchases/${em.id}/goodsreceipt`, { body: corpoPerAggiornamento(nuovo) });
      return `EM ${documento.docNumber} (Giobby id ${em.id}, ${ordine.docDescription})${avvisi.length ? ` - ${avvisi.length} avvisi` : ''}`;
    } catch (e) {
      if (creataOra) { // non lasciare in Giobby un'Entrata Merci con le quantità dell'ordine
        try { await this.http.richiesta('DELETE', `/purchases/${em.id}/goodsreceipt`); } catch { /* resta da cancellare a mano: il riprovo la riprende */ }
      }
      throw e;
    }
  }

  /**
   * Modifica di un DDT GIÀ caricato: riscrive l'Entrata Merci esistente (stesso id) con i dati corretti del DDT.
   *  - l'EM si ritrova dal riferimento salvato al carico ("... Giobby id 12 ...") o, in mancanza, dal vecchio numero DDT
   *  - quantità, lotti, scadenze, righe tolte (tra gli articoli già nell'EM) e numero DDT vengono aggiornati
   *  - l'ordine non si può cambiare, e un articolo mai caricato non si aggiunge (errore chiaro, niente scritto)
   *  - un lotto già presente in Giobby non viene modificato: se la scadenza è diversa o un lotto non serve più, esce un avviso
   * @returns {{riferimento:string, avvisi:string[]}}
   */
  async aggiornaCarico(ddtOriginale, { riferimento, precedente } = {}) {
    const numeroDdt = String(ddtOriginale.numero_ddt ?? '').trim();
    if (!numeroDdt) throw new Error('Numero DDT mancante');
    const senzaZeri = (s) => cifre(s).replace(/^0+/, '');
    if (precedente && senzaZeri(precedente.numero_ordine_cliente) && senzaZeri(precedente.numero_ordine_cliente) !== senzaZeri(ddtOriginale.numero_ordine_cliente)) {
      throw new Error('Il numero d\'ordine non si può cambiare dopo il carico: l\'Entrata Merci resta collegata al suo ordine');
    }

    // codici del fornitore -> codici di Giobby (prima di scrivere qualsiasi cosa)
    const risoluzioni = risolviArticoli(ddtOriginale.righe, await this.prodotti());
    const daScegliere = righeDaScegliere(ddtOriginale.righe, risoluzioni);
    if (daScegliere) throw new Error(daScegliere);
    const ddt = conCodiciGiobby(ddtOriginale, risoluzioni);

    let emId = /Giobby id (\d+)/.exec(String(riferimento ?? ''))?.[1];
    if (!emId) {
      const vecchio = String(precedente?.numero_ddt ?? numeroDdt).trim();
      const trovate = (await this.#elenco('/purchases/goodsreceipt', 'documentsHeaders')).filter((d) => String(d.docNumber) === vecchio);
      if (trovate.length !== 1) throw new Error(`Non trovo l'Entrata Merci di questo DDT in Giobby (${trovate.length} risultati per il n° ${vecchio}): correggila a mano in Giobby`);
      emId = String(trovate[0].id);
    }

    const { document: documento } = await this.http.get(`/purchases/${emId}/goodsreceipt`);
    if (!documento?.rows) throw new Error(`Entrata Merci ${emId} non leggibile in Giobby`);
    const { documento: nuovo, avvisi: avvisiRighe, nonCaricate } = adattaEntrataMerci(documento, ddt);
    if (nonCaricate.length) {
      throw new Error(`Articoli non presenti nell'Entrata Merci: ${nonCaricate.join(', ')}. Un articolo che non era stato caricato non si può aggiungere da qui: fallo in Giobby`);
    }
    if (!nuovo.rows.some((r) => r.idPosType === 1)) throw new Error('Nessuna riga del DDT corrisponde all\'Entrata Merci');

    const avvisi = avvisiRighe.map((a) => a.replace(/è nell'ordine ma non nel DDT, tolto dal carico/, 'non è più nel DDT: tolto dall\'Entrata Merci'));
    avvisi.push(...await this.#assicuraLotti(ddt.righe, ddt));
    const lottiOra = new Set(ddt.righe.map((r) => String(r.lotto ?? '').trim().toUpperCase()).filter(Boolean));
    for (const r of precedente?.righe ?? []) {
      const l = String(r.lotto ?? '').trim();
      if (l && !lottiOra.has(l.toUpperCase())) avvisi.push(`Il lotto ${l} creato con il carico precedente resta in Giobby: eliminalo a mano se non serve più`);
    }

    nuovo.docNumber = numeroDdt;
    const senzaDdt = String(nuovo.note ?? '').replace(/(?:\s-\s)?DDT fornitore n\. .*? del (?:\d{4}-\d{2}-\d{2}|\?)/g, '').trim();
    nuovo.note = [senzaDdt, `DDT fornitore n. ${numeroDdt} del ${ddt.data_ddt || '?'}`].filter(Boolean).join(' - ').slice(0, 250);
    await this.http.richiesta('PUT', `/purchases/${emId}/goodsreceipt`, { body: corpoPerAggiornamento(nuovo) });

    const rif = String(riferimento ?? '');
    const nuovoRif = /^EM .*? \(Giobby id/.test(rif) ? rif.replace(/^EM .*? \(Giobby id/, `EM ${numeroDdt} (Giobby id`) : `EM ${numeroDdt} (Giobby id ${emId})`;
    return { riferimento: nuovoRif, avvisi };
  }

  // ------------------------------------------------------------ Consegne parziali

  /** Id dell'Entrata Merci dal riferimento salvato al carico ("... Giobby id 12 ..."). */
  #idEm(riferimento) {
    const id = /Giobby id (\d+)/.exec(String(riferimento ?? ''))?.[1];
    if (!id) throw new Error('Riferimento Giobby mancante: non so quale Entrata Merci controllare');
    return id;
  }

  /**
   * Situazione dell'ordine a cui si riferisce un carico: cosa è stato ordinato, ricevuto e cosa manca.
   * Ordinato = righe dell'ordine; ricevuto = somma delle righe di tutte le Entrate Merci dello stesso fornitore
   * che portano il "Riferimento a ODA n" (anche quelle fatte a mano in Giobby).
   */
  async residuoDelCarico(riferimento) {
    const emId = this.#idEm(riferimento);
    const { document: em } = await this.http.get(`/purchases/${emId}/goodsreceipt`);
    const numero = numeroOrdine((em?.rows ?? []).find((r) => r.idPosType === 5)?.description);
    if (!numero) throw new Error('L\'Entrata Merci non cita un ordine: non posso calcolare cosa manca');
    const ordini = await this.#elenco('/purchases/orders', 'documentsHeaders');
    const testata = ordini.find((o) => String(Number(cifre(o.docNumber))) === String(Number(numero)) && String(o.idVendor) === String(em.idVendor));
    if (!testata) throw new Error(`Ordine ODA ${numero} non trovato in Giobby`);
    const { document: ordine } = await this.http.get(`/purchases/${testata.id}/orders`);

    const entrate = [];
    for (const h of await this.#elenco('/purchases/goodsreceipt', 'documentsHeaders')) {
      if (String(h.idVendor) !== String(em.idVendor) || Number(h.createDate) < Number(testata.createDate) - 60_000) continue;
      entrate.push((await this.http.get(`/purchases/${h.id}/goodsreceipt`)).document);
    }
    const righe = calcolaResiduo(ordine, ricevutoPerOrdine(entrate, ordine.docNumber));
    const figli = await this.#ordiniDelResto(testata, ordini); // anche se già ricevuto del tutto: serve per dire dove è finito il resto
    const successore = figli.find((o) => STATI_ORDINE_APERTO.includes(o.docStatus)) ?? [...figli].sort((a, b) => Number(b.id) - Number(a.id))[0];
    return {
      ordine: { id: testata.id, descrizione: testata.docDescription, stato: ordine.docStatus, statoDescrizione: ordine.docStatusDesc },
      aperto: STATI_ORDINE_APERTO.includes(ordine.docStatus),
      righe,
      mancaQualcosa: righe.some((r) => r.residuo > 0),
      successore: successore ? { id: successore.id, descrizione: successore.docDescription } : null,
    };
  }

  /**
   * Il resto non arriva più entro il mese: si crea un nuovo ordine con il residuo (consegna = data indicata,
   * "ODA n" nei riferimenti interni) e si chiude l'ordine di partenza ("Ordine evaso").
   * Prima si crea il nuovo e poi si chiude il vecchio: se la chiusura fallisce il nuovo ordine viene tolto,
   * così non restano due ordini aperti per la stessa merce. Se il nuovo esiste già (tentativo interrotto) non se ne crea un altro.
   */
  async chiudiOrdineConResiduo(riferimento, { consegna }) {
    if (dataGiobby(consegna) == null) throw new Error('Data di consegna non valida');
    const info = await this.residuoDelCarico(riferimento);
    if (!info.aperto) throw new Error(`L'ordine ${info.ordine.descrizione} è già "${info.ordine.statoDescrizione || info.ordine.stato}"`);
    const mancanti = info.righe.filter((r) => r.residuo > 0);
    if (!mancanti.length) throw new Error('Non manca niente: l\'ordine è completo');

    const { document: ordine } = await this.http.get(`/purchases/${info.ordine.id}/orders`);
    let nuovo = info.successore ? { id: info.successore.id, docDescription: info.successore.descrizione } : null;
    let creatoOra = false;
    if (!nuovo) {
      await this.http.post('/purchases/orders', corpoOrdineResiduo(ordine, mancanti, { oggi: this.oggi(), consegna }));
      creatoOra = true;
      const dopo = await this.#elenco('/purchases/orders', 'documentsHeaders');
      const trovati = (await this.#ordiniDelResto(ordine, dopo)).filter((o) => STATI_ORDINE_APERTO.includes(o.docStatus));
      nuovo = trovati.sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (!nuovo) throw new Error('Il nuovo ordine è stato creato ma non lo ritrovo in Giobby: controlla a mano (e non chiudere il vecchio)');
    }
    try {
      await this.http.richiesta('PUT', `/purchases/${ordine.id}/orders`, { body: { ...corpoPerAggiornamento(ordine), docStatus: 'COMPLETED_ORDER' } });
    } catch (e) {
      if (creatoOra) {
        try { await this.http.richiesta('DELETE', `/purchases/${nuovo.id}/orders`); } catch { /* da togliere a mano: non c'è altro da fare */ }
      }
      throw e;
    }
    return { chiuso: info.ordine.descrizione, nuovo: nuovo.docDescription, nuovoId: nuovo.id, righe: mancanti.length };
  }
}

export const getGiobbyClient = () => (config.giobbyMode === 'api' ? new ApiGiobby() : new DryRunGiobby());
