// Formattazione per la visualizzazione (i dati nel DB restano ISO e UTC).

/** 2026-02-27 -> 27/02/2026 */
export function fmtData(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || '—';
}

// created_at è salvato in UTC senza "Z": lo si interpreta come UTC e lo si mostra nell'ora locale.
const toDate = (s) => new Date(`${String(s).replace(' ', 'T')}Z`);

/** 2026-10-08T14:17:11 (UTC) -> 08/10/2026, 16:17 (ora locale) */
export function fmtOra(s) {
  if (!s) return '—';
  const d = toDate(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "adesso", "12 min fa", "3 h fa", "2 g fa" */
export function fmtFa(s) {
  if (!s) return '—';
  const d = toDate(s);
  if (Number.isNaN(d.getTime())) return s;
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (min < 1) return 'adesso';
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h fa`;
  return `${Math.round(h / 24)} g fa`;
}

export function saluto(now = new Date()) {
  const h = now.getHours();
  return h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
}

export function dataEstesa(now = new Date()) {
  const t = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}