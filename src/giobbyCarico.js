// Trasformazioni pure tra il DDT letto da Gemini e i documenti di Giobby.
// Nessuna chiamata di rete: si collaudano con dati finti e (fuori dai test) con lo script scripts/giobby-prova-em.js.

const FUSO = 'Europe/Rome';

/** Minuti di scarto dall'UTC del fuso italiano in un certo istante (60 d'inverno, 120 d'estate). */
function scartoMinuti(istante) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: FUSO, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(istante)).map((x) => [x.type, x.value]),
  );
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - istante) / 60000;
}

/** "2027-12-31" -> millisecondi della mezzanotte italiana, come li salva Giobby. Null se la data non esiste. */
export function dataGiobby(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const nominale = Date.UTC(y, mo - 1, d);
  const verifica = new Date(nominale);
  if (verifica.getUTCMonth() !== mo - 1 || verifica.getUTCDate() !== d) return null; // es. 2027-02-31
  let t = nominale - scartoMinuti(nominale) * 60000;
  t = nominale - scartoMinuti(t) * 60000; // secondo passaggio: corretto anche vicino al cambio d'ora
  return t;
}

const norm = (s) => String(s ?? '').trim().toUpperCase();

/**
 * Adatta un'Entrata Merci creata da un ordine (tutte le righe, quantità dell'ordine) a quello che dice il DDT:
 *  - righe del DDT con lo stesso codice articolo: quantità, lotto e scadenza vengono dal DDT
 *  - articolo dell'ordine assente nel DDT: la riga viene tolta (non è arrivato)
 *  - articolo nel DDT ma non nell'ordine: NON viene caricato, resta un avviso
 *  - più righe del DDT per lo stesso articolo (lotti diversi): la riga dell'EM viene duplicata
 *  - righe di riferimento/testo (es. "Riferimento a ODA N. 1") restano
 * Ritorna { documento, avvisi, nonCaricate } (nonCaricate = codici del DDT che non si sono potuti abbinare all'ordine). Non modifica l'oggetto ricevuto.
 */
export function adattaEntrataMerci(documento, ddt) {
  const avvisi = [];
  const nonCaricate = [];
  const righeDdt = (ddt?.righe ?? []).filter((r) => norm(r.codice_articolo));
  const usate = new Set();
  const nuove = [];
  let maxPos = Math.max(0, ...documento.rows.map((r) => Number(r.idPos) || 0));
  const gestiti = new Set(); // articoli già sistemati (un articolo può avere più righe nell'EM: una per lotto)

  for (const riga of documento.rows) {
    if (riga.idPosType !== 1 || !riga.idMaterial) { nuove.push({ ...riga }); continue; }
    const articolo = norm(riga.idMaterial);
    if (gestiti.has(articolo)) continue; // già riempito insieme alla prima riga di questo articolo
    gestiti.add(articolo);

    const delDdt = righeDdt
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => !usate.has(i) && norm(r.codice_articolo) === articolo);
    if (!delDdt.length) {
      avvisi.push(`${riga.idMaterial}: è nell'ordine ma non nel DDT, tolto dal carico`);
      continue;
    }

    // righe già presenti per questo articolo: si riusano in ordine (così una modifica dopo il carico non le rinumera),
    // quelle che mancano si ricavano dalla prima
    const esistenti = documento.rows.filter((x) => x.idPosType === 1 && norm(x.idMaterial) === articolo);
    delDdt.forEach(({ r, i }, k) => {
      usate.add(i);
      const copia = esistenti[k] ? { ...esistenti[k] } : { ...riga, idPos: ++maxPos };
      copia.quantity = Number(r.quantita);
      const lotto = String(r.lotto ?? '').trim();
      copia.idLot = lotto || null;
      copia.expiredate = lotto ? dataGiobby(r.data_scadenza) : null;
      if (lotto && copia.expiredate == null) avvisi.push(`${riga.idMaterial}: lotto ${lotto} senza una scadenza valida`);
      nuove.push(copia);
    });
  }

  righeDdt.forEach((r, i) => {
    if (!usate.has(i)) {
      nonCaricate.push(String(r.codice_articolo).trim());
      avvisi.push(`${r.codice_articolo}: è nel DDT ma non nell'ordine, non caricato`);
    }
  });

  return { documento: { ...documento, rows: nuove }, avvisi, nonCaricate };
}

/** Riga di riepilogo leggibile (per i log e per lo script di prova). */
const dataItaliana = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO }).format(new Date(ms)); // AAAA-MM-GG
export const descriviRiga = (r) => (r.idPosType === 1
  ? `${r.idMaterial}  qta ${r.quantity} ${r.um || ''}  lotto ${r.idLot ?? '-'}  scad ${r.expiredate ? dataItaliana(r.expiredate) : '-'}`
  : `(testo) ${r.description}`);

const CAMPI_TESTATA = ['idDocumentType', 'idDocumentTypeExt', 'destIdStorage', 'destIdLocation', 'idOrderType', 'idContact', 'idCustomer', 'idVendor', 'docNumber', 'docDate', 'idNumerator', 'note', 'internalNote'];
const CAMPI_RIGA = ['idPos', 'idMaterial', 'idPosType', 'price', 'quantity', 'dsc1', 'dsc2', 'dsc3', 'dsc4', 'idVat', 'description', 'um', 'idStorage', 'idLocation', 'idLot', 'expiredate', 'note'];

/**
 * Corpo "da scrivere" per il PUT: solo i campi di testata e di riga che si possono mandare,
 * senza i valori calcolati da Giobby (totali, vendorData, date di creazione...).
 * destIdStorage "-1" (valore di lettura) si sostituisce con il magazzino delle righe.
 */
export function corpoPerAggiornamento(documento) {
  const corpo = {};
  for (const k of CAMPI_TESTATA) if (documento[k] !== undefined && documento[k] !== null) corpo[k] = documento[k];
  const magazzino = documento.rows.find((r) => r.idStorage)?.idStorage;
  if (!corpo.destIdStorage || corpo.destIdStorage === '-1') corpo.destIdStorage = magazzino || 'MB';
  corpo.idDocumentTypeExt = String(corpo.idDocumentTypeExt ?? '0');
  corpo.rows = documento.rows.map((r) => {
    const riga = {};
    for (const k of CAMPI_RIGA) if (r[k] !== undefined && r[k] !== null) riga[k] = r[k];
    return riga;
  });
  return corpo;
}

/** Data di oggi in Italia come AAAA-MM-GG (la data dell'Entrata Merci è il giorno di arrivo della merce). */
export const oggiIso = (adesso = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO }).format(adesso);
// ---------------------------------------------------------------- Consegne parziali (ordine residuo)

/** "ODA N. 6 del 12/10/26", "ODA 6", "oda n°6" -> "6". Null se non c'è un numero d'ordine. */
export const numeroOrdine = (testo) => /ODA\s*(?:N\.?\s*°?\s*)?(\d+)/i.exec(String(testo ?? ''))?.[1] ?? null;

const arrotonda = (n) => Math.round(n * 1000) / 1000;

/**
 * Quantità ricevute per articolo, per un ordine, lette da una o più Entrate Merci.
 * Nell'EM, ogni ordine è introdotto da una riga di testo "Riferimento a ODA N. 6 del ...": le righe articolo
 * che la seguono (fino al prossimo riferimento) sono merce di quell'ordine.
 * @returns {Map<string, number>} codice articolo -> quantità ricevuta
 */
export function ricevutoPerOrdine(entrateMerci, numero) {
  const tot = new Map();
  for (const em of entrateMerci) {
    let corrente = null;
    for (const r of em.rows ?? []) {
      if (r.idPosType === 5) { corrente = numeroOrdine(r.description); continue; }
      if (r.idPosType === 1 && corrente != null && Number(corrente) === Number(numero) && r.idMaterial) {
        tot.set(r.idMaterial, arrotonda((tot.get(r.idMaterial) ?? 0) + Number(r.quantity || 0)));
      }
    }
  }
  return tot;
}

/** Ordinato / ricevuto / residuo per ogni riga articolo dell'ordine. */
export function calcolaResiduo(ordine, ricevuto) {
  const per = new Map();
  for (const r of ordine.rows ?? []) {
    if (r.idPosType !== 1 || !r.idMaterial) continue;
    const x = per.get(r.idMaterial) ?? { codice: r.idMaterial, descrizione: r.description, um: r.um, ordinato: 0 };
    x.ordinato = arrotonda(x.ordinato + Number(r.quantity || 0));
    per.set(r.idMaterial, x);
  }
  return [...per.values()].map((x) => {
    const ric = ricevuto.get(x.codice) ?? 0;
    return { ...x, ricevuto: ric, residuo: Math.max(0, arrotonda(x.ordinato - ric)) };
  });
}

const RIGA_ORDINE = ['idMaterial', 'idPosType', 'price', 'quantity', 'dsc1', 'dsc2', 'dsc3', 'dsc4', 'idVat', 'description', 'um', 'idStorage', 'idLocation', 'accountCode', 'note'];

/**
 * Corpo del POST per il nuovo ordine che raccoglie il residuo di un ordine chiuso.
 * Il numero lo assegna Giobby; nei riferimenti interni c'è "ODA n" dell'ordine di partenza (è il collegamento tra i due).
 * @param residui [{codice, residuo}]  solo le righe con residuo > 0
 */
export function corpoOrdineResiduo(ordine, residui, { oggi, consegna }) {
  const base = corpoPerAggiornamento(ordine);
  delete base.docNumber;
  delete base.note;
  const quanti = new Map(residui.map((r) => [r.codice, r.residuo]));
  const rows = [];
  for (const r of ordine.rows) {
    if (r.idPosType !== 1 || !quanti.get(r.idMaterial)) continue;
    const riga = {};
    for (const k of RIGA_ORDINE) if (r[k] !== undefined && r[k] !== null) riga[k] = r[k];
    riga.quantity = quanti.get(r.idMaterial);
    riga.deliveryDate = dataGiobby(consegna);
    quanti.delete(r.idMaterial); // un articolo ripetuto su più righe: il residuo si mette una volta sola
    rows.push(riga);
  }
  return { ...base, idBu: ordine.idBu, docDate: dataGiobby(oggi), internalNote: `ODA ${ordine.docNumber}`, rows };
}

/** Millisecondi di Giobby -> "AAAA-MM-GG" (giorno italiano); null se manca. */
export const isoDaGiobby = (ms) => (ms ? dataItaliana(Number(ms)) : null);

/**
 * Giacenze per il picking: report di Giobby (con dettaglio per lotto) + anagrafica lotti (da lì viene la scadenza).
 * Conta la quantità FISICA in magazzino (quantity): gli ordini di vendita da evadere li legge e li assegna il picking stesso,
 * quindi togliere anche quelli già impegnati da Giobby (availableQty) vorrebbe dire contarli due volte.
 * Le righe senza merce (es. solo "ordinato al fornitore") si scartano; un lotto senza anagrafica resta, senza scadenza.
 * @returns {{articolo:string, lotto:string|null, scadenza:string|null, ubicazione:string|null, magazzino:string|null, disponibile:number}[]}
 */
export function giacenzeDaReport(report = [], lotti = []) {
  const scadenze = new Map(lotti.map((l) => [`${norm(l.idMaterial)}|${norm(l.idLot)}`, l.expireDate]));
  return report
    .filter((r) => Number(r.quantity) > 0)
    .map((r) => ({
      articolo: norm(r.idMaterial),
      lotto: String(r.idLot ?? '').trim() || null,
      scadenza: isoDaGiobby(scadenze.get(`${norm(r.idMaterial)}|${norm(r.idLot)}`)),
      ubicazione: String(r.idLocation ?? '').trim() || null,
      magazzino: r.idStorage || null,
      disponibile: arrotonda(Number(r.quantity)),
    }));
}

/**
 * Ordine di vendita di Giobby (dettaglio) -> ordine per il picking:
 * { id:'ODV 1', idGiobby, cliente, stato, consegna:'AAAA-MM-GG', righe:[{articolo, descrizione, quantita}] }.
 * La consegna è la più vicina tra le righe; contano solo le righe merce (idPosType 1) con quantità > 0.
 */
export function ordineVenditaPerPicking(doc) {
  const righe = (doc?.rows ?? []).filter((r) => Number(r.idPosType) === 1 && Number(r.quantity) > 0 && r.idMaterial);
  const consegne = righe.map((r) => Number(r.deliveryDate)).filter((n) => Number.isFinite(n) && n > 0);
  return {
    id: `ODV ${String(doc.docNumber ?? doc.id).trim()}`,
    idGiobby: doc.id,
    cliente: doc.companyName || doc.idCustomer || null,
    stato: doc.docStatusDesc || doc.docStatus || null,
    consegna: consegne.length ? isoDaGiobby(Math.min(...consegne)) : null,
    righe: righe.map((r) => ({ articolo: norm(r.idMaterial), descrizione: String(r.description ?? '').trim() || null, quantita: arrotonda(Number(r.quantity)) })),
  };
}

// ---------- DDT in uscita (Modulo B) ----------
const CAMPI_RIGA_ORDINE = ['idPos', 'idMaterial', 'idPosType', 'price', 'quantity', 'dsc1', 'dsc2', 'dsc3', 'dsc4', 'idVat', 'description', 'um', 'idStorage', 'idLocation', 'note', 'deliveryDate'];

/** Corpo del PUT /sales/{id}/orders: testata come l'ha data Giobby, righe indicate (solo campi scrivibili, deliveryDate compresa). */
export function corpoOrdineVendita(ordine, righe) {
  const corpo = corpoPerAggiornamento(ordine);
  corpo.rows = righe.map((r) => {
    const x = {};
    for (const k of CAMPI_RIGA_ORDINE) if (r[k] !== undefined && r[k] !== null) x[k] = r[k];
    return x;
  });
  return corpo;
}

/**
 * Righe dell'ordine di vendita spezzate per lotto: ogni lotto preso dal magazzino diventa una riga (la prima tiene l'idPos, le altre
 * ne sono prive e Giobby le numera). Se si preleva meno dell'ordinato, il resto resta in una riga a parte (senza lotto).
 * @param prelievi [{ articolo, lotto, quantita }]. Un articolo non prelevato resta com'è. Più del richiesto = errore.
 */
export function righeOrdineSpezzate(righeOrdine, prelievi) {
  const out = [];
  for (const r of righeOrdine) {
    if (r.idPosType !== 1 || !r.idMaterial) { out.push({ ...r }); continue; }
    const lotti = prelievi.filter((p) => String(p.articolo).trim().toUpperCase() === String(r.idMaterial).trim().toUpperCase() && Number(p.quantita) > 0);
    if (!lotti.length) { out.push({ ...r }); continue; }
    const totale = lotti.reduce((t, p) => t + Number(p.quantita), 0);
    const ordinata = Number(r.quantity);
    if (totale > ordinata + 1e-9) throw new Error(`${r.idMaterial}: da prelevare ${arrotonda(totale)} ma l'ordine ne chiede ${arrotonda(ordinata)}`);
    lotti.forEach((p, k) => {
      const copia = { ...r, quantity: Number(p.quantita) };
      if (k > 0) delete copia.idPos;
      out.push(copia);
    });
    if (ordinata - totale > 1e-9) { const resto = { ...r, quantity: arrotonda(ordinata - totale) }; delete resto.idPos; out.push(resto); }
  }
  return out;
}
