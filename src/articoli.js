// Abbinamento tra le righe del DDT del fornitore e gli articoli di Giobby.
// Regole (concordate con Artigeniale):
//  1. il codice sul DDT è il Codice Secondario di Giobby (basicCode) -> si risale al codice primario (id)
//  2. se il codice non c'è o non si trova, si confronta la descrizione (uguale, ignorando maiuscole e spazi; solo se un solo articolo la ha)
//  3. altrimenti la riga è "da scegliere": l'operatore indica a quale articolo corrisponde (campo articolo_giobby della riga)
// Nessuna approssimazione: nel dubbio la riga resta da scegliere, mai un abbinamento a caso.

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

export const METODI = {
  scelta: 'scelto dall\'operatore',
  codice: 'dal codice del fornitore (codice secondario)',
  codice_primario: 'dal codice dell\'articolo',
  descrizione: 'dalla descrizione',
};

/** Catalogo ridotto ai campi che servono: [{ id, codice, descrizione, um }]. */
export const catalogo = (prodotti = []) => prodotti
  .filter((p) => p?.id)
  .map((p) => ({ id: String(p.id), codice: String(p.basicCode ?? '').trim(), descrizione: String(p.description_IT || p.description || '').trim(), um: p.um || '' }));

function unico(trovati, metodo, motivoAmbiguo) {
  if (trovati.length === 1) return { stato: 'ok', id: trovati[0].id, metodo, descrizioneGiobby: trovati[0].descrizione };
  if (trovati.length > 1) return { stato: 'da_scegliere', motivo: motivoAmbiguo };
  return null;
}

/** Una riga del DDT -> { stato: 'ok'|'da_scegliere'|'vuota', id?, metodo?, motivo? } */
export function risolviRiga(riga, articoli) {
  const codice = norm(riga.codice_articolo);
  const descr = norm(riga.descrizione);
  const scelta = norm(riga.articolo_giobby);
  if (!codice && !descr && !scelta) return { stato: 'vuota' };

  if (scelta) {
    const a = articoli.find((x) => norm(x.id) === scelta);
    if (a) return { stato: 'ok', id: a.id, metodo: 'scelta', descrizioneGiobby: a.descrizione };
    return { stato: 'da_scegliere', motivo: `l'articolo scelto (${riga.articolo_giobby}) non esiste più in Giobby` };
  }
  if (codice) {
    const r = unico(articoli.filter((x) => norm(x.codice) === codice), 'codice', `il codice ${riga.codice_articolo} è associato a più articoli in Giobby`)
      ?? unico(articoli.filter((x) => norm(x.id) === codice), 'codice_primario', '');
    if (r) return r;
  }
  if (descr) {
    const r = unico(articoli.filter((x) => norm(x.descrizione) === descr), 'descrizione', 'più articoli in Giobby hanno la stessa descrizione');
    if (r) return r;
  }
  return { stato: 'da_scegliere', motivo: codice ? `il codice ${riga.codice_articolo} non è tra i codici secondari di Giobby` : 'la riga non ha un codice' };
}

export const risolviArticoli = (righe = [], articoli = []) => righe.map((r) => risolviRiga(r, articoli));

/** Messaggio per le righe ancora da scegliere (null se è tutto abbinato). */
export function righeDaScegliere(righe, risoluzioni) {
  const elenco = risoluzioni
    .map((x, i) => ({ x, r: righe[i], n: i + 1 }))
    .filter(({ x }) => x.stato === 'da_scegliere')
    .map(({ x, r, n }) => `riga ${n} (${[r.codice_articolo, r.descrizione].filter(Boolean).join(' - ') || 'senza codice'}): ${x.motivo}`);
  return elenco.length ? `Articoli da abbinare a mano: ${elenco.join('; ')}` : null;
}

/** DDT con i codici sostituiti dal codice primario di Giobby (le righe vuote restano com'erano). */
export const conCodiciGiobby = (ddt, risoluzioni) => ({
  ...ddt,
  righe: ddt.righe.map((r, i) => (risoluzioni[i]?.stato === 'ok' ? { ...r, codice_articolo: risoluzioni[i].id } : r)),
});