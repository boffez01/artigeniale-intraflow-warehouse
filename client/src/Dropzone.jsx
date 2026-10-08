import { useRef, useState } from 'react';
import { api } from './api.js';
import Icon from './Icons.jsx';

const ACCETTATI = /\.(pdf|jpe?g|png)$/i;

/** Caricamento DDT: trascina i file o clicca. Più file insieme = uno alla volta (rispetta i limiti di Gemini). */
export default function Dropzone({ onDone }) {
  const [drag, setDrag] = useState(false);
  const [coda, setCoda] = useState([]); // { nome, stato: attesa|lettura|ok|dup|errore, ids, msg }
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  async function carica(files) {
    const lista = [...files].filter((f) => ACCETTATI.test(f.name));
    if (!lista.length || busy) return;
    setBusy(true);
    const stato = lista.map((f) => ({ nome: f.name, stato: 'attesa' }));
    setCoda([...stato]);
    for (let i = 0; i < lista.length; i++) {
      stato[i] = { nome: lista[i].name, stato: 'lettura' };
      setCoda([...stato]);
      try {
        const r = await api.upload(lista[i]);
        stato[i] = { nome: lista[i].name, stato: r.duplicato ? 'dup' : 'ok', ids: r.ids };
      } catch (e) {
        stato[i] = { nome: lista[i].name, stato: 'errore', msg: e.message };
      }
      setCoda([...stato]);
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    onDone?.();
    // un solo file con un solo DDT: si va dritti alla verifica
    if (lista.length === 1 && stato[0].stato === 'ok' && stato[0].ids.length === 1) {
      window.location.hash = `#/ddt/${stato[0].ids[0]}`;
    }
  }

  const onDrop = (e) => { e.preventDefault(); setDrag(false); carica(e.dataTransfer.files); };

  return (
    <div>
      <div className={`dropzone ${drag ? 'drag' : ''} ${busy ? 'busy' : ''}`}
           onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
           onDragLeave={() => setDrag(false)}
           onDrop={onDrop}
           onClick={() => !busy && input.current?.click()}
           role="button" tabIndex={0}
           onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) input.current?.click(); }}>
        <Icon n="upload" size={30} />
        <strong>{busy ? 'Lettura con AI in corso…' : 'Trascina qui i DDT'}</strong>
        <span>{busy ? 'Qualche secondo per ogni file' : 'oppure clicca per sceglierli · PDF, JPG, PNG · anche più file insieme'}</span>
        <input ref={input} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png"
               onChange={(e) => carica(e.target.files)} />
      </div>

      {coda.length > 0 && (
        <ul className="up-list">
          {coda.map((c, i) => (
            <li key={i} className={c.stato}>
              <span className="up-ico"><Icon n={c.stato === 'errore' ? 'xcircle' : c.stato === 'ok' || c.stato === 'dup' ? 'check' : 'clock'} size={16} /></span>
              <span className="up-nome" title={c.nome}>{c.nome}</span>
              <span className="up-esito">
                {c.stato === 'attesa' && 'In coda'}
                {c.stato === 'lettura' && 'Lettura…'}
                {c.stato === 'errore' && c.msg}
                {c.stato === 'dup' && 'Già acquisito'}
                {(c.stato === 'ok' || c.stato === 'dup') && c.ids.length > 1 && ` · ${c.ids.length} DDT`}
                {(c.stato === 'ok' || c.stato === 'dup') && (
                  <> · {c.ids.map((id) => <a key={id} href={`#/ddt/${id}`}>#{id}</a>)}</>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}