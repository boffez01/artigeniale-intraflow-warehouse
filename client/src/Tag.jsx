export const STATO = {
  da_verificare: 'Da verificare',
  in_invio: 'In invio',
  caricato: 'Caricato',
  errore: 'Errore',
  scartato: 'Scartato',
};

export default function Tag({ status }) {
  return <span className={`tag ${status}`}><i />{STATO[status] || status}</span>;
}

/** Colonna "Controlli": cosa resta da fare prima del carico (esito salvato dell'ultima validazione). */
export function Controlli({ r }) {
  if (!['da_verificare', 'errore', 'in_invio'].includes(r.status)) return <span className="muted">—</span>;
  if (r.status === 'errore') {
    return <span className="chk err">{r.n_righe ? 'Invio non riuscito' : 'Lettura fallita'}</span>;
  }
  if (!r.n_errori && !r.n_avvisi) return <span className="chk ok">Pronto al carico</span>;
  return (
    <span className="chk-group">
      {r.n_errori > 0 && <span className="chk err" title="Errori bloccanti: vanno corretti prima del carico">{r.n_errori} {r.n_errori === 1 ? 'errore' : 'errori'}</span>}
      {r.n_avvisi > 0 && <span className="chk warn" title="Avvisi da guardare">{r.n_avvisi} {r.n_avvisi === 1 ? 'avviso' : 'avvisi'}</span>}
    </span>
  );
}