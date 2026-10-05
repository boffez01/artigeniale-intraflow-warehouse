// Template HTML (server-side, nessuna dipendenza).
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const layout = (body) => `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Artigeniale · Carico DDT</title>
<style>
 body{font-family:system-ui,sans-serif;margin:0;background:#f5f6f8;color:#1c2430}
 header{background:#12395b;color:#fff;padding:14px 24px}header a{color:#fff;text-decoration:none;font-weight:600}
 main{max-width:1100px;margin:24px auto;padding:0 16px}
 .card{background:#fff;border-radius:8px;padding:18px;margin-bottom:18px;box-shadow:0 1px 3px #0001}
 table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #e5e8ec}
 input{width:100%;box-sizing:border-box;padding:6px;border:1px solid #c7ced6;border-radius:4px}
 .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}label{font-size:12px;color:#5b6572}
 .warn{background:#fff4e0;border-left:4px solid #f0a020;padding:8px 12px;margin:4px 0}
 .ok{background:#e6f6ea;border-left:4px solid #2e9e4f;padding:8px 12px}
 .err{background:#fde8e8;border-left:4px solid #d33;padding:8px 12px;margin:4px 0}
 .info{background:#e8f1fb;border-left:4px solid #2f6fb0;padding:8px 12px;margin:4px 0}
 button{background:#12395b;color:#fff;border:0;border-radius:4px;padding:9px 16px;cursor:pointer;font-size:14px}
 button.sec{background:#6b7785}button.del{background:#a33}
 .tag{padding:2px 8px;border-radius:10px;font-size:12px;background:#e5e8ec}
 .tag.caricato{background:#cdeed7}.tag.errore{background:#f8cccc}.tag.da_verificare{background:#ffe7b8}
 .tag.in_invio{background:#d6e6f8}.tag.scartato{background:#dcdcdc;text-decoration:line-through}
 input.dubbio{border-color:#f0a020}
</style></head><body>
<header><a href="/">Artigeniale · Carico acquisti da DDT</a></header><main>${body}</main></body></html>`;

const tag = (s) => `<span class="tag ${esc(s)}">${esc(s.replace('_', ' '))}</span>`;

export function indexPage(rows) {
  const trs = rows.length
    ? rows.map((r) => `<tr><td>${r.id}</td><td>${esc(r.filename)}</td><td>${tag(r.status)}</td>
        <td>${esc(r.created_at)}</td><td><a href="/ddt/${r.id}">Apri</a></td></tr>`).join('')
    : '<tr><td colspan="5">Nessun DDT ancora.</td></tr>';
  return layout(`
<div class="card"><h3>Carica un DDT (PDF / immagine)</h3>
<form action="/upload" method="post" enctype="multipart/form-data">
<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required style="width:auto">
<button>Leggi con AI</button></form></div>
<div class="card"><h3>DDT acquisiti</h3>
<table><tr><th>#</th><th>File</th><th>Stato</th><th>Data</th><th></th></tr>${trs}</table></div>`);
}

export function reviewPage(row, { esito, dup = false } = {}) {
  const d = row.payload;
  const { errori = [], avvisi = [] } = esito || {};
  const editabile = ['da_verificare', 'errore'].includes(row.status);
  const inp = (name, val, extra = '') => `<input name="${name}" value="${esc(val)}" ${extra}>`;
  const rows = (d.righe || []).map((r, i) => {
    const dub = (campo) => (r.campi_incerti.includes(campo) || !r[campo] ? 'class="dubbio"' : '');
    return `<tr>
 <td>${inp(`r${i}_codice_articolo`, r.codice_articolo)}</td>
 <td>${inp(`r${i}_descrizione`, r.descrizione)}</td>
 <td>${inp(`r${i}_quantita`, r.quantita)}</td>
 <td>${inp(`r${i}_unita_misura`, r.unita_misura)}</td>
 <td>${inp(`r${i}_lotto`, r.lotto, dub('lotto'))}</td>
 <td>${inp(`r${i}_data_scadenza`, r.data_scadenza, dub('data_scadenza'))}</td></tr>`;
  }).join('');
  return layout(`
<div class="card"><h3>DDT #${row.id} — ${esc(row.filename)} ${tag(row.status)}</h3>
${dup ? '<div class="info">Questo file era già stato acquisito: ti mostro il documento esistente.</div>' : ''}
${row.status === 'caricato' ? `<div class="ok">Registrato su Giobby · rif. ${esc(row.giobby_ref)}</div>` : ''}
${row.status === 'in_invio' ? '<div class="info">Invio a Giobby in corso (o interrotto): non reinviare, controlla prima su Giobby.</div>' : ''}
${row.error ? `<div class="err">Errore: ${esc(row.error)}</div>` : ''}
${errori.map((w) => `<div class="err">⛔ ${esc(w)}</div>`).join('')}
${errori.length && editabile ? '<p><b>Correggi gli errori e salva: finché ci sono, il carico su Giobby è bloccato.</b></p>' : ''}
${avvisi.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}
<p><a href="/ddt/${row.id}/file" target="_blank">Apri documento originale ↗</a></p></div>
<form method="post" action="/ddt/${row.id}/conferma">
<div class="card"><div class="grid">
 <div><label>Fornitore</label>${inp('fornitore', d.fornitore)}</div>
 <div><label>P.IVA fornitore</label>${inp('partita_iva_fornitore', d.partita_iva_fornitore)}</div>
 <div><label>Cliente</label>${inp('cliente', d.cliente)}</div>
 <div><label>N° DDT</label>${inp('numero_ddt', d.numero_ddt)}</div>
 <div><label>Data DDT</label>${inp('data_ddt', d.data_ddt, 'placeholder="AAAA-MM-GG"')}</div>
 <div><label>N° ordine cliente</label>${inp('numero_ordine_cliente', d.numero_ordine_cliente)}</div>
</div></div>
<div class="card"><table>
<tr><th>Codice</th><th>Descrizione</th><th>Q.tà</th><th>UM</th><th>Lotto</th><th>Scadenza</th></tr>${rows}</table>
<input type="hidden" name="n_righe" value="${(d.righe || []).length}"></div>
${editabile ? `<button name="azione" value="salva" class="sec">Salva modifiche</button>
<button name="azione" value="invia">Conferma e carica su Giobby</button>
<button formaction="/ddt/${row.id}/scarta" class="del" formnovalidate>Scarta (duplicato / errato)</button>` : ''}
</form>`);
}
