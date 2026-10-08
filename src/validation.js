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
  // P.IVA di Artigeniale: se compare come P.IVA del FORNITORE è quasi sempre un errore di lettura
  pivaCliente: process.env.PIVA_CLIENTE || '01115770297',
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

const ultimoGiorno = (anno, mese) => new Date(Date.UTC(anno, mese, 0)).getUTCDate();
const meseAnnoInIso = (mese, anno) => {
  const mo = Number(mese);
  const y = anno.length === 2 ? 2000 + Number(anno) : Number(anno);
  if (mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(ultimoGiorno(y, mo)).padStart(2, '0')}`;
};

/**
 * Scadenza in ingresso -> { data, fineMese }.
 * Mese/anno ("4/27", "06/27", "08/2026", "2027-04") => ULTIMO giorno del mese, con fineMese=true
 * (il giorno è un'assunzione: viene segnalata con un avviso). Date complete: come normalizeDate.
 */
export function normalizeScadenza(s) {
  const t = s == null ? '' : String(s).trim();
  if (!t) return { data: null, fineMese: false };
  let m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m) { const d = meseAnnoInIso(m[2], m[1]); return d ? { data: d, fineMese: true } : { data: t, fineMese: false }; }
  m = /^(\d{1,2})[/.-](\d{4}|\d{2})$/.exec(t);
  if (m) { const d = meseAnnoInIso(m[1], m[2]); return d ? { data: d, fineMese: true } : { data: t, fineMese: false }; }
  return { data: normalizeDate(t), fineMese: false };
}

/** "KG." -> "KG", " pz " -> "PZ" */
export const normalizeUm = (s) => (s == null ? null : String(s).trim().replace(/\.+$/, '').toUpperCase() || null);

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
    causale_trasporto: ddt.causale_trasporto?.trim() || null,
    righe: ddt.righe.map((r) => {
      const { data, fineMese } = normalizeScadenza(r.data_scadenza);
      return {
        ...r,
        lotto: normalizeLotto(r.lotto),
        unita_misura: normalizeUm(r.unita_misura),
        data_scadenza: data,
        // la marcatura resta se la data è ancora quella già convertita (il frontend la azzera quando l'utente la modifica)
        scadenza_a_fine_mese: fineMese || (r.scadenza_a_fine_mese === true && ISO.test(data ?? '')),
      };
    }),
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
    // Non tutti i fornitori riportano il nostro ordine (es. solo la loro conferma): avviso, non blocco.
    avvisi.push("Numero ordine cliente non trovato: da collegare a mano all'ordine su Giobby");
  }
  if (!ddt.partita_iva_fornitore && !ddt.fornitore) {
    errori.push('Fornitore non identificato (serve P.IVA o ragione sociale)');
  } else if (ddt.partita_iva_fornitore === REGOLE.pivaCliente) {
    errori.push(`P.IVA fornitore uguale a quella di Artigeniale (${REGOLE.pivaCliente}): probabile errore di lettura`);
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
        if (r.scadenza_a_fine_mese) avvisi.push(`${tag}: scadenza scritta solo mese/anno: assunto l'ULTIMO giorno del mese (${r.data_scadenza})`);
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