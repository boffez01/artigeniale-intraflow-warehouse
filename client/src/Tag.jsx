import { useState } from 'react';

export const STATO = {
  da_verificare: 'Da verificare',
  in_invio: 'In invio',
  caricato: 'Caricato',
  errore: 'Errore',
  scartato: 'Scartato',
};

// Spiegazioni in parole semplici (per chi usa il programma ogni tanto): cosa significa e cosa fare.
export const SPIEGA_STATO = {
  da_verificare: ['Da verificare', 'Il programma ha letto il DDT ma non è ancora stato caricato. Apri la scheda, controlla i dati con il documento a fianco e premi «Conferma e carica su Giobby».'],
  in_invio: ['In invio', 'Il DDT sta andando su Giobby. Aspetta qualche secondo. Se resta così a lungo non riprovare: prima controlla su Giobby.'],
  caricato: ['Caricato', 'La merce è già registrata su Giobby. Non devi fare altro.'],
  errore: ['Errore', 'Il DDT non è stato letto o non è stato caricato. Apri la scheda: in alto c\'è scritto il motivo. Correggi e riprova, oppure scarta il DDT.'],
  scartato: ['Scartato', 'Messo da parte (ad esempio duplicato o sbagliato). Non viene caricato su Giobby.'],
};

/** Nota che compare passandoci sopra col mouse (o con la tastiera). Posizionata sullo schermo: non viene tagliata dalle tabelle. */
export function Spiega({ titolo, testo, children }) {
  const [pos, setPos] = useState(null);
  const mostra = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: Math.min(r.left, window.innerWidth - 300), y: r.bottom + 8 });
  };
  return (
    <span className="tip" tabIndex={0} onMouseEnter={mostra} onFocus={mostra} onMouseLeave={() => setPos(null)} onBlur={() => setPos(null)}>
      {children}
      {pos && (
        <span className="tipbox" role="tooltip" style={{ left: pos.x, top: pos.y }}>
          {titolo && <b>{titolo}</b>}
          {testo}
        </span>
      )}
    </span>
  );
}

export default function Tag({ status }) {
  const [titolo, testo] = SPIEGA_STATO[status] || [STATO[status] || status, ''];
  const tag = <span className={`tag ${status}`}><i />{STATO[status] || status}</span>;
  return testo ? <Spiega titolo={titolo} testo={testo}>{tag}</Spiega> : tag;
}

/** Colonna "Stato controlli": cosa resta da fare prima del carico (esito salvato dell'ultima validazione). */
export function Controlli({ r }) {
  if (!['da_verificare', 'errore', 'in_invio'].includes(r.status)) {
    return (
      <Spiega titolo="Controlli" testo="Non serve più: il DDT è già stato chiuso (caricato o scartato).">
        <span className="muted">—</span>
      </Spiega>
    );
  }
  if (r.status === 'errore') {
    return (
      <Spiega titolo={r.n_righe ? 'Invio non riuscito' : 'Lettura fallita'}
              testo={r.n_righe ? 'I dati sono stati letti ma il carico su Giobby non è andato a buon fine. Apri la scheda per vedere il motivo.' : 'Il file non è stato letto (ad esempio PDF incompleto). Rifai la scansione e caricalo di nuovo.'}>
        <span className="chk err">{r.n_righe ? 'Invio non riuscito' : 'Lettura fallita'}</span>
      </Spiega>
    );
  }
  if (!r.n_errori && !r.n_avvisi) {
    return (
      <Spiega titolo="Pronto al carico" testo="Il programma non ha trovato problemi. Apri la scheda, dai un'occhiata ai dati e conferma.">
        <span className="chk ok">Pronto al carico</span>
      </Spiega>
    );
  }
  return (
    <span className="chk-group">
      {r.n_errori > 0 && (
        <Spiega titolo="Errori" testo="Dati mancanti o incoerenti. Finché non li correggi nella scheda, il carico su Giobby è bloccato.">
          <span className="chk err">{r.n_errori} {r.n_errori === 1 ? 'errore' : 'errori'}</span>
        </Spiega>
      )}
      {r.n_avvisi > 0 && (
        <Spiega titolo="Avvisi" testo="Cose da guardare con attenzione (ad esempio una scadenza dedotta). Non bloccano il carico, ma controlla prima di confermare.">
          <span className="chk warn">{r.n_avvisi} {r.n_avvisi === 1 ? 'avviso' : 'avvisi'}</span>
        </Spiega>
      )}
    </span>
  );
}