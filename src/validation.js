// Regole di validazione e normalizzazione dei dati del DDT.
// Tracciabilità alimentare = lotto + scadenza: qui i formati devono essere esatti.
//
// check() separa:
//  - errori  -> BLOCCANTI: il carico su Giobby non parte finché non vengono corretti
//  - avvisi  -> da guardare, ma si può procedere
//
// Nessuna "correzione" silenziosa dei dati di magazzino: si normalizza solo la FORMA
// (maiuscolo, formato data), mai il VALORE (niente arrotondamenti di quantità, niente O->0).

export const REGOLE = {
  // Lotto: 2-24 caratteri, solo A-Z 0-9 e / . _ -, deve iniziare con lettera o cifra.
  // ADATTARE al formato reale dei fornitori di Artigeniale quando avremo i DDT veri.
  lottoRegex: /^[A-Z0-9][A-Z0-9/._-]{1,23}$/,
  scadenzaMaxAnni: 10,       // oltre: probabile errore di lettura (es. 2062 invece di 2026)
  scadenzaBreveGiorni: 30,   // sotto: avviso "scadenza ravvicinata"
  umDiscrete: ['PZ', 'CT', 'NR', 'CF'], // unità a pezzi: la quantità DEVE essere intera
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data ISO AAAA-MM-GG *esistente* sul calendario (rifiuta 2026-02-31, 2026-99-99). Ritorna Date UTC o null. */
export function parseIso(s) {
  const m = ISO.exec(s ?? '');
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  return ok ? dt : null;
}

/** Converte GG/MM/AAAA, GG-MM-AAAA, GG.MM.AAAA (anche anno a 2 cifre) in ISO. Altrimenti lascia com'è. */
export function normalizeDate(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (!m) return t;
  const [, d, mo, y] = m;
  const yyyy = y.length === 2 ? `20${y}` : y;
  return `${yyyy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function normalizeLotto(s) {
  if (s == null) return null;
  return String(s).trim().toUpperCase() || null;
}

export function normalizePiva(s) {
  if (s == null) return null;
  const t = String(s).toUpperCase().replace(/[\s.\-]/g, '').replace(/^IT/, '');
  return t || null;
}

/** N° DDT: maiuscolo, senza spazi; gli zeri iniziali si tolgono solo se è puramente numerico ("0123" = "123"). */
export function normalizeNumeroDdt(s) {
  if (s == null) return null;
  let t = String(s).toUpperCase().replace(/\s+/g, '');
  if (/^\d+$/.test(t)) t = t.replace(/^0+(?=\d)/, '');
  return t || null;
}

/** Applica le normalizzazioni a tutto il DDT. Da chiamare PRIMA di check(). */
export function normalize(ddt) {
  return {
    ...ddt,
    fornitore: ddt.fornitore?.trim() || null,
    partita_iva_fornitore: normalizePiva(ddt.partita_iva_fornitore),
    numero_ddt: normalizeNumeroDdt(ddt.numero_ddt),
    numero_ordine_cliente: ddt.numero_ordine_cliente?.trim() || null,
    data_ddt: normalizeDate(ddt.data_ddt),
    righe: ddt.righe.map((r) => ({
      ...r,
      lotto: normalizeLotto(r.lotto),
      data_scadenza: normalizeDate(r.data_scadenza),
    })),
  };
}

/** Chiave di idempotenza: fornitore (P.IVA, o ragione sociale se manca) + n° DDT + data DDT. */
export function chiaveDdt(ddt) {
  const forn = ddt.partita_iva_fornitore || (ddt.fornitore || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!forn || !ddt.numero_ddt || !parseIso(ddt.data_ddt)) return null;
  return `${forn}|${ddt.numero_ddt}|${ddt.data_ddt}`;
}

export function metaDdt(ddt) {
  return {
    chiave_ddt: chiaveDdt(ddt),
    numero_ddt: ddt.numero_ddt || null,
    data_ddt: parseIso(ddt.data_ddt) ? ddt.data_ddt : null,
  };
}

// Aritmetica sui giorni SEMPRE su mezzanotti UTC: nessuna dipendenza da fuso orario o ora legale.
const oggiUtc = (now) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
const giorni = (a, b) => Math.round((a - b) / 86_400_000);

/**
 * @param ddt   DDT già normalizzato
 * @param opts  { now, duplicato: {id,status}|null, simili: [{id}] }  (duplicati calcolati dal DB dal chiamante)
 */
export function check(ddt, { now = new Date(), duplicato = null, simili = [] } = {}) {
  const errori = [];
  const avvisi = [];
  const oggi = oggiUtc(now);

  // --- Testata
  if (!ddt.numero_ordine_cliente) {
    errori.push("Numero ordine cliente mancante: impossibile agganciare l'ordine su Giobby");
  }
  if (!ddt.partita_iva_fornitore && !ddt.fornitore) {
    errori.push('Fornitore non identificato (serve P.IVA o ragione sociale)');
  } else if (ddt.partita_iva_fornitore && !/^\d{11}$/.test(ddt.partita_iva_fornitore)) {
    avvisi.push(`P.IVA fornitore "${ddt.partita_iva_fornitore}" non è di 11 cifre (fornitore estero o errore di lettura)`);
  }
  if (!ddt.numero_ddt) errori.push('Numero DDT mancante: serve per evitare doppi caricamenti');

  let dataDdt = null;
  if (!ddt.data_ddt) {
    errori.push('Data DDT mancante: serve per evitare doppi caricamenti');
  } else {
    dataDdt = parseIso(ddt.data_ddt);
    if (!dataDdt) errori.push(`Data DDT non valida (${ddt.data_ddt}): formato richiesto AAAA-MM-GG`);
  }

  // --- Idempotenza
  if (duplicato) {
    errori.push(`DUPLICATO: questo DDT è già stato acquisito come #${duplicato.id} (${duplicato.status.replace('_', ' ')}). Se è la stessa consegna, scartalo.`);
  }
  for (const s of simili) {
    avvisi.push(`Stesso n° e data DDT del #${s.id} ma fornitore diverso o non riconosciuto: verifica che non sia lo stesso documento`);
  }

  if (!ddt.righe.length) errori.push('Nessuna riga articolo trovata');

  // --- Righe
  const visti = new Map();
  ddt.righe.forEach((r, idx) => {
    const tag = `Riga ${idx + 1}`;

    if (!r.lotto) {
      errori.push(`${tag}: lotto mancante`);
    } else if (!REGOLE.lottoRegex.test(r.lotto)) {
      errori.push(`${tag}: lotto "${r.lotto}" non valido (2-24 caratteri: lettere, numeri, / . _ - ; niente spazi)`);
    }

    if (!r.data_scadenza) {
      errori.push(`${tag}: data di scadenza mancante`);
    } else {
      const sc = parseIso(r.data_scadenza);
      if (!sc) {
        errori.push(`${tag}: data di scadenza "${r.data_scadenza}" non valida (formato AAAA-MM-GG, data esistente)`);
      } else {
        const gg = giorni(sc, oggi);
        if (gg < 0) errori.push(`${tag}: merce GIÀ SCADUTA (${r.data_scadenza})`);
        else if (gg <= REGOLE.scadenzaBreveGiorni) avvisi.push(`${tag}: scadenza ravvicinata (${gg} giorni)`);
        if (gg > 365 * REGOLE.scadenzaMaxAnni) {
          avvisi.push(`${tag}: scadenza oltre ${REGOLE.scadenzaMaxAnni} anni (${r.data_scadenza}): possibile errore di lettura`);
        }
        if (dataDdt && sc < dataDdt) avvisi.push(`${tag}: scadenza precedente alla data del DDT`);
      }
    }

    if (r.quantita == null || !Number.isFinite(r.quantita) || r.quantita <= 0) {
      errori.push(`${tag}: quantità mancante o non valida`);
    } else if (REGOLE.umDiscrete.includes((r.unita_misura || '').toUpperCase()) && !Number.isInteger(r.quantita)) {
      // BLOCCANTE e mai arrotondata in automatico: 2,5 PZ -> 2 falsificherebbe la giacenza.
      errori.push(`${tag}: quantità decimale (${r.quantita}) con unità "${r.unita_misura}": correggi quantità o unità di misura`);
    }

    if (r.campi_incerti.length) avvisi.push(`${tag}: letti con incertezza -> ${r.campi_incerti.join(', ')}`);

    if (r.codice_articolo && r.lotto) {
      const k = `${r.codice_articolo}|${r.lotto}`;
      if (visti.has(k)) avvisi.push(`${tag}: stesso articolo e lotto della riga ${visti.get(k)}`);
      else visti.set(k, idx + 1);
    }
  });

  return { errori, avvisi };
}
