import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { fmtData, fmtOra } from './format.js';
import Icon from './Icons.jsx';
import { ricordaLista } from './nav.js';
import Tag, { Controlli, STATO } from './Tag.jsx';

const DEF = { q: '', stato: '', fornitore: '', da: '', a: '', sort: 'id', dir: 'desc', limit: 25, page: 0 };
const LIMITI = [10, 25, 50, 100];
// [chiave di ordinamento (null = non ordinabile), titolo]
const COLONNE = [
  ['id', '#'], ['data', 'Data DDT'], ['numero', 'N° DDT'], ['fornitore', 'Fornitore'], [null, 'Ordine'],
  ['righe', 'Righe'], ['controlli', 'Controlli'], ['stato', 'Stato'], ['acquisito', 'Acquisito'],
];
const DESC_PER_DEFAULT = new Set(['id', 'data', 'righe', 'controlli', 'acquisito']);

// I filtri vivono nell'URL (#/archivio?stato=errore&q=...): il tasto Indietro e il link dalla scheda li ritrovano.
const daUrl = (query) => {
  const p = new URLSearchParams(query);
  const limit = Number(p.get('limit'));
  return {
    q: p.get('q') || '', stato: p.get('stato') || '', fornitore: p.get('fornitore') || '',
    da: p.get('da') || '', a: p.get('a') || '',
    sort: p.get('sort') || DEF.sort, dir: p.get('dir') === 'asc' ? 'asc' : 'desc',
    limit: LIMITI.includes(limit) ? limit : DEF.limit,
    page: Math.max(0, Number.parseInt(p.get('page') || '0', 10) || 0),
  };
};
const versoUrl = (f) => {
  const p = new URLSearchParams();
  for (const k of ['q', 'stato', 'fornitore', 'da', 'a']) if (f[k]) p.set(k, f[k]);
  if (f.sort !== DEF.sort || f.dir !== DEF.dir) { p.set('sort', f.sort); p.set('dir', f.dir); }
  if (f.limit !== DEF.limit) p.set('limit', f.limit);
  if (f.page > 0) p.set('page', f.page);
  const s = p.toString();
  return `#/archivio${s ? `?${s}` : ''}`;
};
const paramsApi = (f) => ({
  q: f.q, stato: f.stato, fornitore: f.fornitore, da: f.da, a: f.a, sort: f.sort, dir: f.dir, limit: f.limit,
});

export default function Archivio({ query }) {
  const [f, setF] = useState(() => daUrl(query));
  const [qInput, setQInput] = useState(f.q);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const set = (patch, mantieniPagina = false) =>
    setF((o) => ({ ...o, ...patch, page: mantieniPagina ? (patch.page ?? o.page) : 0 }));

  // URL sempre allineato ai filtri (replaceState: non riempie la cronologia)
  useEffect(() => {
    const h = versoUrl(f);
    window.history.replaceState(null, '', h);
    ricordaLista(h);
  }, [f]);

  // la ricerca parte 300 ms dopo l'ultimo tasto
  useEffect(() => {
    if (qInput === f.q) return undefined;
    const t = setTimeout(() => set({ q: qInput }), 300);
    return () => clearTimeout(t);
  }, [qInput, f.q]);

  const carica = useCallback(async (silenzioso) => {
    const mio = ++seq.current; // scarta le risposte arrivate in ritardo
    if (!silenzioso) setLoading(true);
    try {
      const r = await api.lista({ ...paramsApi(f), offset: f.page * f.limit });
      if (mio !== seq.current) return;
      if (!r.items.length && r.total > 0 && f.page > 0) { // pagina oltre la fine (es. dopo uno scarto)
        setF((o) => ({ ...o, page: Math.max(0, Math.ceil(r.total / o.limit) - 1) }));
        return;
      }
      setData(r); setErr('');
    } catch (e) {
      if (mio === seq.current) setErr(e.message);
    } finally {
      if (mio === seq.current) setLoading(false);
    }
  }, [f]);

  useEffect(() => {
    carica(false);
    const t = setInterval(() => carica(true), 5000);
    return () => clearInterval(t);
  }, [carica]);

  const ordina = (k) => {
    if (f.sort === k) set({ dir: f.dir === 'asc' ? 'desc' : 'asc' });
    else set({ sort: k, dir: DESC_PER_DEFAULT.has(k) ? 'desc' : 'asc' });
  };
  const azzera = () => { setQInput(''); setF({ ...DEF, limit: f.limit }); };
  const filtriAttivi = Boolean(f.q || f.stato || f.fornitore || f.da || f.a);

  const counts = data?.counts;
  const per = counts?.per_stato || {};
  const chips = [['', 'Tutti', counts?.totale], ...['da_verificare', 'errore', 'caricato', 'scartato'].map((s) => [s, STATO[s], per[s] || 0])];
  if (per.in_invio) chips.splice(3, 0, ['in_invio', STATO.in_invio, per.in_invio]);

  const totale = data?.total ?? 0;
  const da = totale === 0 ? 0 : f.page * f.limit + 1;
  const a = Math.min(totale, (f.page + 1) * f.limit);
  const pagine = Math.max(1, Math.ceil(totale / f.limit));
  const fornitori = data?.fornitori || [];

  return (
    <>
      <div className="pagetitle">
        <div>
          <h1>Archivio DDT</h1>
          <p>Tutti i documenti acquisiti, collegati al database. Cerca anche per lotto o articolo per la tracciabilità.</p>
        </div>
        <a className="btn sec" href={api.csvUrl(paramsApi(f))} download><Icon n="download" size={16} />Esporta CSV</a>
      </div>

      <div className="chips" role="tablist" aria-label="Filtra per stato">
        {chips.map(([s, label, n]) => (
          <button key={s || 'tutti'} role="tab" aria-selected={f.stato === s} className={`chip ${f.stato === s ? 'on' : ''} ${s}`}
                  onClick={() => set({ stato: s })}>
            {label}<span>{n ?? '–'}</span>
          </button>
        ))}
      </div>

      <div className="card toolbar">
        <div className="search">
          <Icon n="search" size={16} />
          <input type="search" value={qInput} onChange={(e) => setQInput(e.target.value)}
                 placeholder="Cerca fornitore, n° DDT, lotto, articolo, ordine, #scheda…" aria-label="Cerca" />
        </div>
        <select value={f.fornitore} onChange={(e) => set({ fornitore: e.target.value })} aria-label="Fornitore">
          <option value="">Tutti i fornitori</option>
          {f.fornitore && !fornitori.includes(f.fornitore) && <option value={f.fornitore}>{f.fornitore}</option>}
          {fornitori.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <label className="date"><span>Dal</span><input type="date" value={f.da} max={f.a || undefined} onChange={(e) => set({ da: e.target.value })} /></label>
        <label className="date"><span>Al</span><input type="date" value={f.a} min={f.da || undefined} onChange={(e) => set({ a: e.target.value })} /></label>
        {filtriAttivi && <button className="ghost" onClick={azzera}>Azzera filtri</button>}
      </div>

      {err && <div className="err">Impossibile leggere l&apos;archivio: {err}</div>}

      <div className={`card table-card ${loading ? 'loading' : ''}`}>
        <div className="scroll">
          <table className="list">
            <thead>
              <tr>
                {COLONNE.map(([k, titolo]) => (
                  <th key={titolo} className={k ? 'sortable' : ''} onClick={k ? () => ordina(k) : undefined}
                      aria-sort={k && f.sort === k ? (f.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {titolo}{k && f.sort === k && <span className="sort">{f.dir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {!data && !err && [0, 1, 2, 3, 4, 5].map((i) => <tr key={i}><td colSpan={10}><div className="sk" /></td></tr>)}
              {data?.items.map((r) => (
                <tr key={r.id} className={`row ${r.status}`} onClick={() => { window.location.hash = `#/ddt/${r.id}`; }}>
                  <td className="muted">#{r.id}</td>
                  <td>{fmtData(r.data_ddt)}</td>
                  <td><b>{r.numero_ddt || '—'}</b></td>
                  <td className="forn"><span>{r.fornitore || <span className="muted">Non letto</span>}</span><div className="sub" title={r.filename}>{r.filename}</div></td>
                  <td>{r.ordine || <span className="muted">—</span>}</td>
                  <td className="num">{r.n_righe || <span className="muted">—</span>}</td>
                  <td><Controlli r={r} /></td>
                  <td><Tag status={r.status} /></td>
                  <td className="muted nowrap">{fmtOra(r.created_at)}</td>
                  <td className="act"><a className="btn sm sec" href={`#/ddt/${r.id}`} onClick={(e) => e.stopPropagation()}>Apri</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.items.length === 0 && (
          <div className="empty">
            <Icon n={counts?.totale ? 'search' : 'inbox'} size={34} />
            {counts?.totale ? (
              <>
                <strong>Nessun DDT con questi filtri</strong>
                <span>Prova a cambiare la ricerca o a togliere qualche filtro.</span>
                <button className="sec" onClick={azzera}>Azzera filtri</button>
              </>
            ) : (
              <>
                <strong>Ancora nessun DDT in archivio</strong>
                <span>Carica il primo dalla Home: apparirà qui.</span>
                <a className="btn" href="#/">Vai alla Home</a>
              </>
            )}
          </div>
        )}

        {data && totale > 0 && (
          <div className="pager">
            <span>{da}–{a} di <b>{totale}</b> DDT</span>
            <span className="pager-r">
              <label>Righe per pagina
                <select value={f.limit} onChange={(e) => set({ limit: Number(e.target.value) })}>
                  {LIMITI.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button className="sec sm" disabled={f.page === 0} onClick={() => set({ page: f.page - 1 }, true)} aria-label="Pagina precedente"><Icon n="left" size={16} /></button>
              <span>Pagina {f.page + 1} di {pagine}</span>
              <button className="sec sm" disabled={f.page + 1 >= pagine} onClick={() => set({ page: f.page + 1 }, true)} aria-label="Pagina successiva"><Icon n="right" size={16} /></button>
            </span>
          </div>
        )}
      </div>
    </>
  );
}