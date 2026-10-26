import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { fmtData } from './format.js';

// Controllo picking (ufficio): Tania controlla quello che il magazziniere ha preparato.
// «Tutto ok» blocca l'ordine (lucchetto) e lo rende pronto per il DDT; se corregge un lotto, «Conferma modifica» ricalcola gli altri ordini
// ancora da preparare. Gli ordini già preparati o verificati non si toccano mai.
const arr = (n) => Math.round(n * 1000) / 1000;

export default function Controllo() {
  const [rilasci, setRilasci] = useState(null);
  const [err, setErr] = useState('');
  const [mod, setMod] = useState({});
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const [fatti, setFatti] = useState([]); // DDT emessi in questa sessione: l'ordine esce dall'elenco, l'esito resta visibile

  const leggi = () => api.pickingRilasci().then((r) => setRilasci(r.rilasci)).catch((e) => setErr(e.message));
  useEffect(() => { leggi(); const t = setInterval(leggi, 30000); return () => clearInterval(t); }, []);

  const lista = useMemo(() => (rilasci ?? []).filter((o) => o.stato === 'preparato' || o.stato === 'verificato'), [rilasci]);
  const inPrep = (rilasci ?? []).filter((o) => o.stato === 'rilasciato').length;

  const righeDi = (o) => mod[o.id] ?? (o.preparate ?? o.righe).map((r) => ({ ...r }));
  const cambia = (o, fn) => setMod((m) => { const b = (m[o.id] ?? (o.preparate ?? o.righe).map((r) => ({ ...r }))).map((r) => ({ ...r })); fn(b); return { ...m, [o.id]: b }; });
  const ordinato = (o, art) => arr(o.righe.filter((r) => r.articolo === art).reduce((t, r) => t + r.quantita, 0));
  const richiesto = (o, art) => (o.richieste?.[art] ?? ordinato(o, art));
  const preparato = (rr, art) => arr(rr.filter((r) => r.articolo === art).reduce((t, r) => t + (Number(r.quantita) || 0), 0));
  const previsto = (o, r) => o.righe.find((x) => x.articolo === r.articolo && (x.lotto ?? null) === (r.lotto || null))?.quantita ?? 0;
  const pulisci = (rr) => rr.map(({ extra, ...r }) => ({ ...r, lotto: String(r.lotto || '').trim().toUpperCase() || null, quantita: Number(r.quantita) || 0 }));
  const errori = (o) => {
    const rr = righeDi(o); const e = [];
    for (const art of new Set(rr.map((r) => r.articolo))) if (preparato(rr, art) > richiesto(o, art) + 1e-9) e.push(`${art}: più di quanto serve (${preparato(rr, art)} su ${richiesto(o, art)})`);
    for (const r of rr) if (r.extra && Number(r.quantita) > 0 && (!String(r.lotto || '').trim() || !r.scadenza)) e.push(`${r.articolo}: per il lotto aggiunto scrivi lotto e scadenza`);
    return e;
  };
  const ricalcoloTesto = (r) => (r.errore ? r.errore : r.ricalcolati?.length ? `Ricalcolati gli ordini ancora da preparare: ${r.ricalcolati.join(', ')}.${r.avvisi?.length ? ` Attenzione: ${r.avvisi.join('; ')}` : ''}` : 'Gli altri ordini non cambiano.');

  async function esegui(o, fn) {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const salva = (o) => esegui(o, async () => {
    const r = await api.pickingPreparate(o.id, pulisci(righeDi(o)));
    setMod((m) => { const n = { ...m }; delete n[o.id]; return n; });
    setMsg((m) => ({ ...m, [o.id]: { ok: true, testo: `Modifica confermata. ${ricalcoloTesto(r)}` } })); await leggi();
  });
  const verifica = (o) => esegui(o, async () => {
    if (mod[o.id]) { const r = await api.pickingPreparate(o.id, pulisci(righeDi(o))); setMsg((m) => ({ ...m, [o.id]: { ok: true, testo: `Modifica confermata. ${ricalcoloTesto(r)}` } })); setMod((m) => { const n = { ...m }; delete n[o.id]; return n; }); }
    await api.pickingVerifica(o.id); await leggi();
  });
  const sblocca = (o) => esegui(o, async () => { await api.pickingSblocca(o.id); await leggi(); });
  const emetti = (o) => esegui(o, async () => {
    const rr = pulisci(righeDi(o)).filter((r) => r.quantita > 0);
    const parziale = [...new Set(o.righe.map((r) => r.articolo))].some((a) => preparato(rr, a) < richiesto(o, a));
    const r = await api.pickingDdt(Number(o.idGiobby), rr.map((p) => ({ articolo: p.articolo, lotto: p.lotto, scadenza: p.scadenza, quantita: p.quantita })), { parziale, previsto: o.righe.map((p) => ({ articolo: p.articolo, lotto: p.lotto, quantita: p.quantita })) });
    if (r.ok) setFatti((f) => [{ id: o.id, cliente: o.cliente, idDdt: r.idDdt, testo: `${r.riferimento}${r.avvisi?.length ? ` · ${r.avvisi.join('; ')}` : ''}` }, ...f]);
    else setMsg((m) => ({ ...m, [o.id]: { ok: false, testo: r.error } }));
    await leggi();
  });

  return (
    <div>
      <div className="pagetitle">
        <div>
          <h1>Controllo picking</h1>
          <p>Qui trovi gli ordini che il magazzino ha preparato. Controlla le quantità e i lotti: se è tutto ok blocca l'ordine, poi emetti il DDT. Un ordine bloccato non si può più modificare.</p>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {fatti.map((f) => <div className="ok card" key={f.id}>✔ {f.id} · {f.cliente}: {f.testo}{f.idDdt ? <> · <a href={`/api/picking/ddt/${f.idDdt}/pdf`} target="_blank" rel="noreferrer">Apri PDF del DDT</a></> : null}</div>)}
      {inPrep > 0 && <p className="muted small">{inPrep} {inPrep === 1 ? 'ordine è' : 'ordini sono'} ancora in preparazione al magazzino.</p>}
      {rilasci === null && !err && <p className="muted">Leggo gli ordini…</p>}
      {rilasci && !lista.length && <div className="card"><p className="muted">Nessun ordine da controllare. Compaiono qui quando il magazziniere preme «Conferma picking».</p></div>}
      {lista.map((o) => {
        const rr = righeDi(o); const bloccato = o.stato === 'verificato'; const e = errori(o);
        const articoli = [...new Set(rr.map((r) => r.articolo))];
        const differenze = articoli.some((a) => preparato(rr, a) !== richiesto(o, a)) || rr.some((r) => !r.extra && Number(r.quantita) !== previsto(o, r));
        const m = msg[o.id];
        return (
          <div className="card" key={o.id}>
            <div className="review-title">
              <h2>{bloccato ? '🔒 ' : ''}{o.id} · {o.cliente}{o.provincia ? <span className="muted small"> ({o.provincia})</span> : null}{o.consegna ? <span className="muted small"> · consegna {fmtData(o.consegna)}</span> : null}</h2>
              <span className={`chk ${bloccato ? 'ok' : 'warn'}`}>{bloccato ? 'Verificato · pronto per il DDT' : 'Da verificare'}</span>
            </div>
            {o.nota && <div className="small" style={{ background: '#fff7d6', padding: 8, borderRadius: 8, margin: '8px 0' }}><b>Nota del magazzino:</b> {o.nota}</div>}
            <table className="picking">
              <thead><tr><th>Articolo</th><th>Lotto</th><th>Scadenza</th><th>Ubicazione</th><th>Previsto</th><th>Preparato</th><th>Differenza</th></tr></thead>
              <tbody>
                {rr.map((r, i) => {
                  const prev = r.extra ? 0 : previsto(o, r); const d = arr((Number(r.quantita) || 0) - prev);
                  return (
                    <tr key={i}>
                      <td><b>{r.articolo}</b> <span className="muted small">{r.descrizione || ''}</span></td>
                      <td>{r.extra && !bloccato ? <input style={{ width: 90 }} placeholder="Lotto" value={r.lotto || ''} onChange={(ev) => cambia(o, (b) => { b[i].lotto = ev.target.value; })} /> : (r.lotto || '—')}</td>
                      <td>{r.extra && !bloccato ? <input type="date" value={r.scadenza || ''} onChange={(ev) => cambia(o, (b) => { b[i].scadenza = ev.target.value; })} /> : (r.scadenza ? fmtData(r.scadenza) : '—')}</td>
                      <td>{r.ubicazione || '—'}</td>
                      <td>{prev || '—'}</td>
                      <td><input type="number" min="0" step="any" style={{ width: 90 }} disabled={bloccato} value={r.quantita} onChange={(ev) => cambia(o, (b) => { b[i].quantita = ev.target.value; })} />{r.extra && !bloccato && <button className="sec" onClick={() => cambia(o, (b) => { b.splice(i, 1); })}>✕</button>}</td>
                      <td>{d === 0 ? <span className="muted">—</span> : <span className={`chk ${d < 0 ? 'warn' : 'err'}`}>{d > 0 ? `+${d}` : d}</span>}</td>
                    </tr>
                  );
                })}
                {!bloccato && [...new Set(o.righe.map((r) => r.articolo))].map((art) => (
                  <tr key={`+${art}`}><td colSpan={7}><button className="sec" onClick={() => cambia(o, (b) => { b.push({ articolo: art, descrizione: o.righe.find((x) => x.articolo === art)?.descrizione ?? null, lotto: '', scadenza: '', ubicazione: null, quantita: 0, extra: true }); })}>+ altro lotto per {art}</button></td></tr>
                ))}
              </tbody>
            </table>
            {e.length > 0 && <div className="err small">{e.map((x) => <div key={x}>{x}</div>)}</div>}
            {m && <div className={m.ok ? 'ok' : 'err'}>{m.ok ? '✔ ' : ''}{m.testo}{m.idDdt ? <> · <a href={`/api/picking/ddt/${m.idDdt}/pdf`} target="_blank" rel="noreferrer">Apri PDF del DDT</a></> : null}</div>}
            <div className="actions" style={{ position: 'static' }}>
              {!bloccato && <>
                <button className="sec" disabled={busy || !mod[o.id] || e.length > 0} onClick={() => salva(o)} title="Salva le correzioni e ricalcola gli altri ordini ancora da preparare">Conferma modifica</button>
                <button disabled={busy || e.length > 0} onClick={() => verifica(o)}>✔ Tutto ok: verifica e blocca</button>
              </>}
              {bloccato && <>
                <button disabled={busy || !o.idGiobby} onClick={() => emetti(o)}>Emetti il DDT{differenze ? ' (con le quantità preparate)' : ''}</button>
                <button className="sec" disabled={busy} onClick={() => sblocca(o)}>Sblocca per modificare</button>
              </>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
