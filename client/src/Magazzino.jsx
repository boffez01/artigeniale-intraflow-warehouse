import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { fmtData } from './format.js';

// Pagina del magazziniere: vede SOLO gli ordini che l'ufficio ha rilasciato, uno per cliente, e stampa il foglio da portare a giro.
// Sulla stampa ci sono solo le quantità da prelevare (niente giacenze). Annotazioni di differenza: a penna sul foglio, oppure qui sotto.
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#475569', '#ea580c'];
const colore = (c) => { let h = 0; for (const x of String(c || '')) h = (h * 31 + x.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

export default function Magazzino() {
  const [rilasci, setRilasci] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState({});
  const [solo, setSolo] = useState(null);
  const [tablet, setTablet] = useState(true);

  const leggi = () => api.pickingRilasci().then((r) => { setRilasci(r.rilasci); setNote((n) => ({ ...Object.fromEntries(r.rilasci.map((x) => [x.id, x.nota || ''])), ...n })); }).catch((e) => setErr(e.message));
  useEffect(() => { leggi(); const t = setInterval(leggi, 30000); return () => clearInterval(t); }, []);

  const fogli = useMemo(() => {
    const m = new Map();
    for (const r of rilasci ?? []) { const k = r.cliente; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return [...m.entries()].map(([cliente, ordini]) => ({ cliente, provincia: ordini[0].provincia, ordini }));
  }, [rilasci]);

  // Quantità preparate scritte dal magazziniere (finché non conferma restano solo qui). Di default = quantità da prelevare.
  const [mod, setMod] = useState({});
  const righeDi = (o) => mod[o.id] ?? (o.preparate ?? o.righe).map((r) => ({ ...r }));
  const cambia = (o, fn) => setMod((m) => { const base = (m[o.id] ?? (o.preparate ?? o.righe).map((r) => ({ ...r }))).map((r) => ({ ...r })); fn(base); return { ...m, [o.id]: base }; });
  const richiesto = (o, art) => Math.round(o.righe.filter((r) => r.articolo === art).reduce((t, r) => t + r.quantita, 0) * 1000) / 1000;
  const preparato = (rr, art) => Math.round(rr.filter((r) => r.articolo === art).reduce((t, r) => t + (Number(r.quantita) || 0), 0) * 1000) / 1000;
  const errori = (o) => {
    const rr = righeDi(o); const e = [];
    for (const art of new Set(rr.map((r) => r.articolo))) if (preparato(rr, art) > richiesto(o, art) + 1e-9) e.push(`${art}: più di quanto serve (${preparato(rr, art)} su ${richiesto(o, art)})`);
    for (const r of rr) if (r.extra && Number(r.quantita) > 0 && (!String(r.lotto || '').trim() || !r.scadenza)) e.push(`${r.articolo}: per il lotto aggiunto scrivi lotto e scadenza`);
    return e;
  };
  const pulisci = (rr) => rr.map(({ extra, ...r }) => ({ ...r, lotto: String(r.lotto || '').trim().toUpperCase() || null, quantita: Number(r.quantita) || 0 }));

  async function segna(o, stato) {
    setErr('');
    try { await api.pickingRilascioStato(o.id, stato, note[o.id] ?? '', stato === 'preparato' ? pulisci(righeDi(o)) : undefined); if (stato !== o.stato || stato === 'preparato') setMod((m) => { const n = { ...m }; delete n[o.id]; return n; }); await leggi(); } catch (e) { setErr(e.message); }
  }
  function stampa(cliente) { setSolo(cliente); setTimeout(() => { window.print(); setSolo(null); }, 80); }

  return (
    <div className={tablet ? 'tablet' : ''}>
      <div className="pagetitle noprint">
        <div>
          <h1>Magazzino · da preparare</h1>
          <p>Qui compaiono gli ordini che l'ufficio ha rilasciato. Stampa il foglio del cliente, prepara la merce lotto per lotto e, se c'è qualcosa di diverso, segnalo a penna sul foglio o nella nota.</p>
        </div>
        <button className={tablet ? '' : 'sec'} onClick={() => setTablet((t) => !t)}>📱 Tablet</button>
      </div>
      {err && <div className="err noprint">{err}</div>}
      {rilasci === null && !err && <p className="muted">Leggo gli ordini…</p>}
      {rilasci && !fogli.length && <div className="card noprint"><p className="muted">Nessun ordine da preparare. Quando l'ufficio ne rilascia uno compare qui da solo (la pagina si aggiorna ogni 30 secondi).</p></div>}
      {fogli.map((f) => (
        <div className={`card foglio${solo && solo !== f.cliente ? ' nonstampare' : ''}`} key={f.cliente}>
          <div className="review-title">
            <h2>Picking · {f.cliente}{f.provincia ? <span className="muted small"> ({f.provincia})</span> : null}</h2>
            <span className="noprint"><button onClick={() => stampa(f.cliente)}>🖨 Stampa il foglio</button></span>
          </div>
          {f.ordini.map((o) => {
            const rr = righeDi(o);
            const articoli = [...new Set(o.righe.map((r) => r.articolo))];
            const bloccato = o.stato === 'verificato'; const finito = o.stato === 'preparato';
            const err = errori(o);
            return (
              <div className="ordine-picking" key={o.id}>
                <div className="review-title">
                  <h3>Ordine {o.id}{o.consegna ? <span className="muted small"> · consegna {fmtData(o.consegna)}</span> : null}</h3>
                  <span className={`chk noprint ${bloccato ? 'ok' : finito ? 'ok' : 'warn'}`}>{bloccato ? '🔒 Verificato dall\'ufficio' : finito ? 'Preparato · in attesa di controllo' : 'Da preparare'}</span>
                </div>
                {o.ricalcolatoIl && o.stato === 'rilasciato' && <div className="noprint small" style={{ background: '#fff7d6', padding: 8, borderRadius: 8, marginBottom: 8 }}>⚠ I lotti di questo ordine sono stati aggiornati dall'ufficio dopo una correzione: stampa di nuovo il foglio.</div>}
                {o.mancanti?.length > 0 && <div className="noprint small err">Merce non disponibile: {o.mancanti.map((m) => `${m.articolo} (mancano ${m.mancante})`).join(', ')}</div>}
                <table className="picking">
                  <thead><tr><th>Articolo</th><th>Descrizione</th><th>Lotto</th><th>Scadenza</th><th>Ubicazione</th><th>Q.tà</th><th className="noprint">Quantità preparata</th><th className="diff">Preparato / differenze</th></tr></thead>
                  <tbody>
                    {articoli.map((art) => {
                      const righe = o.righe.filter((r) => r.articolo === art);
                      const mie = rr.map((r, i) => ({ r, i })).filter((x) => x.r.articolo === art);
                      const tot = richiesto(o, art); const prep = preparato(rr, art);
                      return (
                        <FragmentArt key={art}>
                          <tr className={`madre${mie.length > 1 ? ' multi' : ''}`}>
                            <td><div className="art"><span className="riquadro" style={{ background: colore(art) }} /><b>{art}</b></div></td>
                            <td className="desc">{righe[0]?.descrizione || mie[0]?.r.descrizione || '—'}</td>
                            <td>{righe.length > 1 ? <span className="chk warn">{righe.length} lotti</span> : ''}</td>
                            <td></td><td></td><td><b>{tot}</b></td>
                            <td className="noprint">{prep !== tot ? <span className={`chk ${prep > tot ? 'err' : 'warn'}`}>preparate {prep} su {tot}</span> : <span className="chk ok">tutto</span>}</td>
                            <td className="diff"></td>
                          </tr>
                          {mie.map(({ r, i }, k) => (
                            <tr key={i} className={`figlia${mie.length > 1 ? ' multi' : ''}`}>
                              <td className="ramo"><span>{k < mie.length - 1 ? '├─' : '└─'}</span></td><td></td>
                              <td>{r.extra && !bloccato && !finito ? <input className="noprint" style={{ width: 90 }} placeholder="Lotto" value={r.lotto || ''} onChange={(e) => cambia(o, (b) => { b[i].lotto = e.target.value; })} /> : (r.lotto || '—')}</td>
                              <td>{r.extra && !bloccato && !finito ? <input className="noprint" type="date" value={r.scadenza || ''} onChange={(e) => cambia(o, (b) => { b[i].scadenza = e.target.value; })} /> : (r.scadenza ? fmtData(r.scadenza) : '—')}</td>
                              <td>{r.ubicazione || '—'}</td>
                              <td>{r.extra ? '' : <b>{righe.find((x) => (x.lotto ?? null) === (r.lotto ?? null))?.quantita ?? r.quantita}</b>}</td>
                              <td className="noprint">
                                <input type="number" min="0" step="any" style={{ width: 90 }} disabled={bloccato || finito} value={r.quantita} onChange={(e) => cambia(o, (b) => { b[i].quantita = e.target.value; })} />
                                {r.extra && !bloccato && !finito && <button className="sec" title="Togli questa riga" onClick={() => cambia(o, (b) => { b.splice(i, 1); })}>✕</button>}
                              </td>
                              <td className="diff"></td>
                            </tr>
                          ))}
                          {!bloccato && !finito && <tr className="noprint"><td></td><td colSpan={7}><button className="sec" onClick={() => cambia(o, (b) => { const ult = b.map((x, j) => (x.articolo === art ? j : -1)).filter((j) => j >= 0).pop(); b.splice(ult + 1, 0, { articolo: art, descrizione: righe[0]?.descrizione ?? null, lotto: '', scadenza: '', ubicazione: null, quantita: 0, extra: true }); })}>+ altro lotto per {art}</button></td></tr>}
                        </FragmentArt>
                      );
                    })}
                  </tbody>
                </table>
                <div className="passi noprint">
                  {err.length > 0 && <div className="err small">{err.map((x) => <div key={x}>{x}</div>)}</div>}
                  {rr.some((r) => !r.extra) && articoli.some((art) => preparato(rr, art) < richiesto(o, art)) && !finito && !bloccato && <div className="small" style={{ background: '#fff7d6', padding: 8, borderRadius: 8 }}>Hai preparato meno del richiesto: scrivi nella nota cosa è successo, l'ufficio riceve l'avviso.</div>}
                  <textarea rows={2} disabled={bloccato} placeholder="Nota per l'ufficio (es. «mancano 2 pezzi del lotto L2610A, presi dal L2610C»)" value={note[o.id] ?? ''} onChange={(e) => setNote((n) => ({ ...n, [o.id]: e.target.value }))} />
                  <div className="actions">
                    {bloccato && <span className="muted small">L'ufficio ha verificato questo ordine: non si può più modificare.</span>}
                    {!bloccato && !finito && <button disabled={err.length > 0} onClick={() => segna(o, 'preparato')}>✔ Conferma picking (ho preparato questo ordine)</button>}
                    {finito && <button className="sec" onClick={() => segna(o, 'rilasciato')}>Riapri (devo correggere qualcosa)</button>}
                    {!bloccato && <button className="sec" onClick={() => segna(o, o.stato)}>Salva la nota</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
const FragmentArt = ({ children }) => <>{children}</>;
