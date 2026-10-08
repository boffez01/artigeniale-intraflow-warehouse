import { useEffect, useState } from 'react';
import { api } from './api.js';
import Archivio from './Archivio.jsx';
import Home from './Home.jsx';
import Icon from './Icons.jsx';
import Review from './Review.jsx';

// Router minimale a hash (#/, #/archivio?stato=errore, #/ddt/12): nessuna dipendenza e nessun fallback da configurare sul server.
// Ogni cambio di hash incrementa `n`: cliccare di nuovo "Archivio DDT" riparte da filtri puliti.
function useHash() {
  const [s, setS] = useState({ hash: window.location.hash || '#/', n: 0 });
  useEffect(() => {
    const on = () => setS((o) => ({ hash: window.location.hash || '#/', n: o.n + 1 }));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return s;
}

function route(hash) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const m = /^\/ddt\/(\d+)/.exec(path);
  if (m) return { name: 'ddt', id: Number(m[1]) };
  if (path.startsWith('/archivio')) return { name: 'archivio', query };
  return { name: 'home' };
}

// Stato del sistema in alto a destra: si capisce a colpo d'occhio se i carichi sono simulati o reali.
function Stato({ info }) {
  if (!info) return null;
  const live = info.giobby_mode === 'api';
  return (
    <div className="pills">
      <span className={`pill ${live ? 'ok' : 'warn'}`} title={live ? 'I carichi vanno su Giobby' : 'Modalità dryrun: i carichi vengono salvati in data/outbox, nulla parte verso Giobby'}>
        <i />Giobby · {live ? 'collegato' : 'simulazione'}
      </span>
      <span className={`pill ${info.gemini_pronto ? 'ok' : 'err'}`} title={info.gemini_pronto ? `Modello: ${info.modello}` : 'Chiave GEMINI_API_KEY mancante nel file .env'}>
        <i />AI · {info.gemini_pronto ? 'pronta' : 'chiave mancante'}
      </span>
    </div>
  );
}

export default function App() {
  const { hash, n } = useHash();
  const r = route(hash);
  const [info, setInfo] = useState(null);
  useEffect(() => { api.info().then(setInfo).catch(() => setInfo(null)); }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <a className="brand" href="#/">
            <span className="logo">A</span>
            <span className="brand-t"><b>Artigeniale</b><small>Gestione magazzino</small></span>
          </a>
          <nav>
            <a className={r.name === 'home' ? 'on' : ''} href="#/"><Icon n="home" size={17} /><span>Home</span></a>
            <a className={r.name === 'archivio' || r.name === 'ddt' ? 'on' : ''} href="#/archivio"><Icon n="list" size={17} /><span>Archivio DDT</span></a>
            <span className="soon" title="Modulo B: ottimizzazione picking ed emissione DDT in uscita"><Icon n="package" size={17} /><span>Picking</span><em>presto</em></span>
          </nav>
          <Stato info={info} />
        </div>
      </header>

      <main className={r.name === 'ddt' ? 'wide' : ''}>
        {r.name === 'ddt' && <Review key={r.id} id={r.id} />}
        {r.name === 'archivio' && <Archivio key={n} query={r.query} />}
        {r.name === 'home' && <Home info={info} />}
      </main>

      <footer className="foot">Modulo A · Carico acquisti da DDT · Praxis Futura</footer>
    </>
  );
}