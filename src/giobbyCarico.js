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

  for (const riga of documento.rows) {
    if (riga.idPosType !== 1 || !riga.idMaterial) { nuove.push({ ...riga }); continue; }

    const delDdt = righeDdt
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => !usate.has(i) && norm(r.codice_articolo) === norm(riga.idMaterial));
    if (!delDdt.length) {
      avvisi.push(`${riga.idMaterial}: è nell'ordine ma non nel DDT, tolto dal carico`);
      continue;
    }

    delDdt.forEach(({ r, i }, k) => {
      usate.add(i);
      const copia = k === 0 ? { ...riga } : { ...riga, idPos: ++maxPos };
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