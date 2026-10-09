// Client Giobby.
// DryRun: scrive il payload in data/outbox (sviluppo e collaudo senza toccare il gestionale).
// ApiGiobby: carico merci vero su Giobby (GIOBBY_MODE=api).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { adattaEntrataMerci, corpoPerAggiornamento, dataGiobby, oggiIso } from './giobbyCarico.js';
import { GiobbyError, GiobbyHttp } from './giobbyHttp.js';

class DryRunGiobby {
  async registraCarico(ddt, { chiave } = {}) {
    const ref = `DRY-${new Date().toISOString().replace(/\D/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(path.join(config.outboxDir, `${ref}.json`), JSON.stringify({ chiave, ...ddt }, null, 2));
    return ref;
  }
}

const STATI_ORDINE_APERTO = ['CREATED', 'GOOD_PARTIAL_RECEIVED'];
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

  async trovaOrdine(ddt) {
    const numeri = new Set((String(ddt.numero_ordine_cliente ?? '').match(/\d+/g) || []).map((n) => String(Number(n))));
    if (!numeri.size) throw new Error('Il DDT non riporta un numero d\'ordine: non so a quale ordine di Giobby agganciare il carico');
    const piva = cifre(ddt.partita_iva_fornitore);
    const candidati = (await this.#elenco('/purchases/orders', 'documentsHeaders')).filter((o) => {
      if (!numeri.has(String(Number(cifre(o.docNumber))))) return false;
      const pivaOrdine = cifre(o.vendorData?.vatcode);
      return !piva || !pivaOrdine || piva === pivaOrdine;
    });
    if (!candidati.length) throw new Error(`Ordine "${ddt.numero_ordine_cliente}" non trovato in Giobby per questo fornitore`);
    if (candidati.length > 1) throw new Error(`Più ordini in Giobby corrispondono a "${ddt.numero_ordine_cliente}" (${candidati.map((o) => o.docDescription).join(', ')}): scegli a mano`);
    const ordine = candidati[0];
    if (!STATI_ORDINE_APERTO.includes(ordine.docStatus)) {
      throw new Error(`L'ordine ${ordine.docDescription} è già "${ordine.docStatusDesc || ordine.docStatus}": non carico altra merce`);
    }
    return ordine;
  }

  async #assicuraLotti(righeDdt, ddt) {
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
  }

  async registraCarico(ddt, { chiave } = {}) {
    const numeroDdt = String(ddt.numero_ddt ?? '').trim();
    if (!numeroDdt) throw new Error('Numero DDT mancante');
    const ordine = await this.trovaOrdine(ddt);

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
}

export const getGiobbyClient = () => (config.giobbyMode === 'api' ? new ApiGiobby() : new DryRunGiobby());