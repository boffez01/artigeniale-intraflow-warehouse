import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { fmtData } from './format.js';
import Icon from './Icons.jsx';
import { ultimaLista } from './nav.js';
import Tag, { Spiega } from './Tag.jsx';

const RIGA_VUOTA = { codice_articolo: '', descrizione: '', quantita: '', unita_misura: '', lotto: '', data_scadenza: '', articolo_giobby: '', scadenza_a_fine_mese: false, campi_incerti: [] };
const TESTATA = [
  ['fornitore', 'Fornitore'], ['partita_iva_fornitore', 'P.IVA fornitore'], ['cliente', 'Cliente'],
  ['numero_ddt', 'N° DDT'], ['data_ddt', 'Data DDT (AAAA-MM-GG)'], ['numero_ordine_cliente', 'N° ordine cliente'],
  ['causale_trasporto', 'Causale trasporto'],
];

// Stringhe nel form, numeri e null solo sul server (che rifà comunque tutta la validazione).
const toForm = (ddt) => ({
  ...ddt,
  righe: ddt.righe.map((r) => ({ ...r, quantita: r.quantita ?? '' })),
});

export default function Review({ id }) {
  const [det, setDet] = useState(null);
  const [form, setForm] = useState(null);
  const [esito, setEsito] = useState({ errori: [], avvisi: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');
  const [abb, setAbb] = useState(null); // abbinamento righe <-> articoli di Giobby ({attivo, articoli, righe} o {errore})

  const applica = useCallback((d) => {
    setDet(d); setForm(toForm(d.ddt)); setEsito(d.esito); setDirty(false);
  }, []);

  useEffect(() => { api.dettaglio(id).then(applica).catch((e) => setErr(e.message)); }, [id, applica]);

  // Abbinamento con gli articoli di Giobby: si aggiorna 0,5 s dopo l'ultima modifica a codici, descrizioni o scelte.
  const chiaveAbb = useMemo(() => JSON.stringify((form?.righe || []).map((r) => [r.codice_articolo, r.descrizione, r.articolo_giobby])), [form]);
  const editabileAbb = det?.modificabile;
  useEffect(() => {
    if (!form || !editabileAbb) return undefined;
    let vivo = true;
    const t = setTimeout(() => {
      api.abbinamento(id, form).then((x) => vivo && setAbb(x)).catch((e) => vivo && setAbb({ errore: e.message }));
    }, 500);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiaveAbb, editabileAbb, id]);

  if (err && !det) return <div className="err">{err} · <a href="#/archivio">Torna all'archivio</a></div>;
  if (!det) return <p>Caricamento…</p>;

  const editabile = det.modificabile; // da verificare/errore: si modifica e si carica; già caricato: si modifica e si aggiorna Giobby
  const caricato = det.status === 'caricato';
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const setRiga = (i, campo, valore) => {
    set({
      righe: form.righe.map((r, k) => k !== i ? r : {
        ...r, [campo]: valore,
        campi_incerti: (r.campi_incerti || []).filter((c) => c !== campo), // l'utente l'ha guardato: il dubbio decade
        // se cambia la data, l'ultimo giorno del mese non è più un'assunzione nostra ma una scelta sua
        ...(campo === 'data_scadenza' ? { scadenza_a_fine_mese: false } : {}),
      }),
    });
  };

  async function esegui(fn) {
    setBusy(true); setErr('');
    try { applica(await fn()); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const salva = () => { setMsg(''); return esegui(() => api.salva(id, form)); };
  const aggiorna = async () => {
    if (!window.confirm('Aggiornare anche l\'Entrata Merci su Giobby con queste modifiche?')) return;
    setBusy(true); setErr(''); setMsg('');
    try { applica(await api.aggiorna(id, form)); setMsg('Modifiche salvate e aggiornate su Giobby.'); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const invia = () => esegui(() => api.invia(id, form));
  const scarta = async () => {
    if (!window.confirm('Scartare questo DDT? (es. è un duplicato)')) return;
    setBusy(true);
    try { await api.scarta(id); window.location.hash = ultimaLista(); } catch (e) { setErr(e.message); setBusy(false); }
  };

  const dubbio = (r, campo) =>
    r.campi_incerti?.includes(campo) || !String(r[campo] ?? '').trim() || (campo === 'data_scadenza' && r.scadenza_a_fine_mese);
  const abbOk = abb?.attivo ? abb : null;
  const daScegliere = abbOk ? abbOk.righe.filter((x) => x.stato === 'da_scegliere').length : 0;
  const fileUrl = `/api/ddt/${id}/file`;
  // il banner "più DDT nel file" conta solo quelli ancora in gioco (gli scartati restano in elenco ma non contano)
  const altri = det.altri_ddt_del_file || [];
  const nelFile = altri.filter((a) => a.status !== 'scartato').length + 1;

  return (
    <>
    <div className="pagehead">
      <a className="back" href={ultimaLista()}><Icon n="left" size={16} />Archivio DDT</a>
    </div>
    <div className="split">
      <div className="viewer">
        {det.file_type === 'pdf'
          ? <iframe src={`${fileUrl}#page=${det.pagina || 1}&view=FitH`} title="DDT originale" />
          : <img src={fileUrl} alt="DDT originale" />}
      </div>

      <div>
        <div className="card">
          <div className="review-title">
            <div>
              <h2>{det.ddt.fornitore || 'DDT'} · n° {det.ddt.numero_ddt || '—'}</h2>
              <p className="muted small">Scheda #{det.id}{det.ddt.data_ddt ? ` · del ${fmtData(det.ddt.data_ddt)}` : ''} · {det.filename}</p>
            </div>
            <Tag status={det.status} />
          </div>
          {caricato && <div className="ok">Registrato su Giobby · rif. {det.giobby_ref}</div>}
          {caricato && <p className="muted small">Puoi correggere i dati: premendo «Salva e aggiorna su Giobby» la modifica arriva anche all'Entrata Merci.</p>}
          {msg && <div className="ok">{msg}</div>}
          {det.status === 'in_invio' && <div className="info">Invio a Giobby in corso (o interrotto): non reinviare, controlla prima su Giobby.</div>}
          {det.error && <div className="err">Errore: {det.error}</div>}
          {err && <div className="err">{err}</div>}
          {esito.errori.map((w, i) => <div className="err" key={`e${i}`}>⛔ {w}</div>)}
          {esito.errori.length > 0 && editabile && <p><b>Correggi gli errori e salva: finché ci sono, il carico su Giobby è bloccato.</b></p>}
          {esito.avvisi.map((w, i) => <div className="warn" key={`w${i}`}>⚠ {w}</div>)}
          {altri.length > 0 && (
            <div className="info">
              Questo file contiene {nelFile} DDT. Questo parte da pagina {det.pagina}. Altri:{' '}
              {altri.map((a) => (
                <a key={a.id} href={`#/ddt/${a.id}`} style={{ marginRight: 10 }}>
                  #{a.id}{a.numero_ddt ? ` (n° ${a.numero_ddt}` : ' ('}, p.{a.pagina || 1}{a.status === 'scartato' ? ', scartato' : ''})
                </a>
              ))}
            </div>
          )}
          {dirty && <div className="info">Modifiche non salvate: gli errori mostrati si riferiscono all'ultima versione salvata.</div>}
        </div>

        <div className="card">
          <div className="grid">
            {TESTATA.map(([k, label]) => (
              <div key={k}>
                <label>{label}</label>
                <input value={form[k] ?? ''} disabled={!editabile} onChange={(e) => set({ [k]: e.target.value })} />
              </div>
            ))}
          </div>
        </div>

        <div className="card scroll">
          <table>
            <thead><tr><th>Codice</th><th>Descrizione</th><th>Q.tà</th><th>UM</th><th>Lotto</th><th>Scadenza</th>{abbOk && <th>Articolo in Giobby</th>}<th /></tr></thead>
            <tbody>
              {form.righe.map((r, i) => (
                <tr key={i}>
                  {['codice_articolo', 'descrizione', 'quantita', 'unita_misura', 'lotto', 'data_scadenza'].map((c) => (
                    <td key={c}>
                      <input value={r[c] ?? ''} disabled={!editabile}
                             className={(c === 'lotto' || c === 'data_scadenza') && dubbio(r, c) ? 'dubbio' : ''}
                             onChange={(e) => setRiga(i, c, e.target.value)} />
                    </td>
                  ))}
                  {abbOk && <td className="abb"><Abbinamento x={abbOk.righe[i]} articoli={abbOk.articoli} riga={r} editabile={editabile} onScegli={(v) => setRiga(i, 'articolo_giobby', v)} /></td>}
                  <td>{editabile && <button className="mini" title="Rimuovi riga"
                        onClick={() => set({ righe: form.righe.filter((_, k) => k !== i) })}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {abb?.errore && <p className="muted small">Abbinamento agli articoli di Giobby non disponibile: {abb.errore}</p>}
          {daScegliere > 0 && <div className="warn">⚠ {daScegliere === 1 ? '1 riga non è stata riconosciuta' : `${daScegliere} righe non sono state riconosciute`}: scegli a quale articolo di Giobby corrisponde nella colonna «Articolo in Giobby». Finché non lo fai il carico è bloccato.</div>}
          {editabile && <button className="sec" style={{ marginTop: 10 }}
            onClick={() => set({ righe: [...form.righe, { ...RIGA_VUOTA }] })}>+ Aggiungi riga</button>}
        </div>

        {caricato && (
          <div className="actions">
            <button disabled={busy || !dirty || daScegliere > 0} onClick={aggiorna}>Salva e aggiorna su Giobby</button>
          </div>
        )}
        {editabile && !caricato && (
          <div className="actions">
            <button className="sec" disabled={busy} onClick={salva}>Salva modifiche</button>
            <button disabled={busy || daScegliere > 0} onClick={invia}>Conferma e carica su Giobby</button>
            <button className="del" disabled={busy} onClick={scarta}>Scarta (duplicato / errato)</button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

const SPIEGA_METODO = {
  scelta: 'Hai scelto tu questo articolo.',
  codice: 'Il codice del DDT coincide con il «Codice secondario» (codice del fornitore) di questo articolo in Giobby.',
  codice_primario: 'Il codice del DDT coincide con il codice dell\'articolo in Giobby.',
  descrizione: 'Il codice non è stato trovato, ma la descrizione è identica a quella di questo articolo in Giobby. Controlla che sia davvero lui.',
};

/** Cella "Articolo in Giobby": riconosciuto (con spiegazione) oppure menu per sceglierlo a mano. */
function Abbinamento({ x, articoli, riga, editabile, onScegli }) {
  if (!x || x.stato === 'vuota') return <span className="muted">—</span>;
  const menu = (
    <select value={riga.articolo_giobby || ''} disabled={!editabile} className={x.stato === 'da_scegliere' ? 'dubbio' : ''} onChange={(e) => onScegli(e.target.value)}>
      <option value="">— scegli l'articolo —</option>
      {articoli.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.descrizione}{a.codice ? ` (${a.codice})` : ''}</option>)}
    </select>
  );
  if (x.stato === 'da_scegliere') {
    return <Spiega titolo="Articolo non riconosciuto" testo={`${x.motivo}. Scegli a quale articolo di Giobby corrisponde questa riga.`}>{menu}</Spiega>;
  }
  if (x.metodo === 'scelta') return menu;
  return (
    <Spiega titolo="Articolo riconosciuto" testo={SPIEGA_METODO[x.metodo]}>
      <span className={`chk ${x.metodo === 'descrizione' ? 'warn' : 'ok'}`}>{x.id} · {x.descrizioneGiobby}</span>
    </Spiega>
  );
}