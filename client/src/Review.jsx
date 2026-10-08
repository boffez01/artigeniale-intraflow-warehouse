import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Tag from './Tag.jsx';

const RIGA_VUOTA = { codice_articolo: '', descrizione: '', quantita: '', unita_misura: '', lotto: '', data_scadenza: '', scadenza_a_fine_mese: false, campi_incerti: [] };
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

  const applica = useCallback((d) => {
    setDet(d); setForm(toForm(d.ddt)); setEsito(d.esito); setDirty(false);
  }, []);

  useEffect(() => { api.dettaglio(id).then(applica).catch((e) => setErr(e.message)); }, [id, applica]);

  if (err && !det) return <div className="err">{err} · <a href="#/">Torna alla lista</a></div>;
  if (!det) return <p>Caricamento…</p>;

  const editabile = det.editabile;
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
  const salva = () => esegui(() => api.salva(id, form));
  const invia = () => esegui(() => api.invia(id, form));
  const scarta = async () => {
    if (!window.confirm('Scartare questo DDT? (es. è un duplicato)')) return;
    setBusy(true);
    try { await api.scarta(id); window.location.hash = '#/'; } catch (e) { setErr(e.message); setBusy(false); }
  };

  const dubbio = (r, campo) =>
    r.campi_incerti?.includes(campo) || !String(r[campo] ?? '').trim() || (campo === 'data_scadenza' && r.scadenza_a_fine_mese);
  const fileUrl = `/api/ddt/${id}/file`;

  return (
    <div className="split">
      <div className="viewer">
        {det.file_type === 'pdf'
          ? <iframe src={`${fileUrl}#page=${det.pagina || 1}&view=FitH`} title="DDT originale" />
          : <img src={fileUrl} alt="DDT originale" />}
      </div>

      <div>
        <div className="card">
          <h3>DDT #{det.id} — {det.filename} <Tag status={det.status} /></h3>
          {det.status === 'caricato' && <div className="ok">Registrato su Giobby · rif. {det.giobby_ref}</div>}
          {det.status === 'in_invio' && <div className="info">Invio a Giobby in corso (o interrotto): non reinviare, controlla prima su Giobby.</div>}
          {det.error && <div className="err">Errore: {det.error}</div>}
          {err && <div className="err">{err}</div>}
          {esito.errori.map((w, i) => <div className="err" key={`e${i}`}>⛔ {w}</div>)}
          {esito.errori.length > 0 && editabile && <p><b>Correggi gli errori e salva: finché ci sono, il carico su Giobby è bloccato.</b></p>}
          {esito.avvisi.map((w, i) => <div className="warn" key={`w${i}`}>⚠ {w}</div>)}
          {det.altri_ddt_del_file?.length > 0 && (
            <div className="info">
              Questo file contiene {det.altri_ddt_del_file.length + 1} DDT. Questo parte da pagina {det.pagina}. Altri:{' '}
              {det.altri_ddt_del_file.map((a) => (
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
            <thead><tr><th>Codice</th><th>Descrizione</th><th>Q.tà</th><th>UM</th><th>Lotto</th><th>Scadenza</th><th /></tr></thead>
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
                  <td>{editabile && <button className="mini" title="Rimuovi riga"
                        onClick={() => set({ righe: form.righe.filter((_, k) => k !== i) })}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {editabile && <button className="sec" style={{ marginTop: 10 }}
            onClick={() => set({ righe: [...form.righe, { ...RIGA_VUOTA }] })}>+ Aggiungi riga</button>}
        </div>

        {editabile && (
          <div className="actions">
            <button className="sec" disabled={busy} onClick={salva}>Salva modifiche</button>
            <button disabled={busy} onClick={invia}>Conferma e carica su Giobby</button>
            <button className="del" disabled={busy} onClick={scarta}>Scarta (duplicato / errato)</button>
          </div>
        )}
      </div>
    </div>
  );
}