# Artigeniale · Modulo A — Carico acquisti da DDT (Node.js)

Flusso: scansione DDT -> lettura Gemini -> controlli (lotto/scadenza/ordine) -> verifica umana -> carico su Giobby.

## Avvio
    npm install
    cp .env.example .env        # inserire GEMINI_API_KEY
    npm start                   # interfaccia su http://localhost:3000
    npm run watcher             # (opz.) acquisisce le scansioni dalla cartella data/inbox

## Test
    npm test

## Regole di validazione (src/validation.js)
Errori = bloccano il carico su Giobby. Avvisi = da guardare. Parametri in `REGOLE`.
- Date: ISO AAAA-MM-GG e realmente esistenti sul calendario; GG/MM/AAAA convertito in automatico. Delta giorni su mezzanotti UTC (indipendente da fuso e ora legale)
- Lotto: maiuscolo, 2-24 caratteri (A-Z 0-9 / . _ -), niente spazi (regex da adattare ai lotti reali)
- Scadenza già passata = errore; entro 30 giorni o oltre 10 anni = avviso
- Quantità > 0; decimale con PZ/CT/NR/CF = **errore** (mai arrotondata in automatico)
- Obbligatori: fornitore (P.IVA o ragione sociale), n° DDT, data DDT, n° ordine cliente
- Si normalizza la FORMA dei dati, mai il VALORE

## Anti-duplicati (idempotenza)
1. Stessa scansione (sha256 del file) già acquisita: nessuna nuova riga, nessuna chiamata a Gemini
2. Stesso DDT ri-scansionato: chiave `fornitore|n°DDT|data` -> errore bloccante "DUPLICATO #N" (con pulsante Scarta)
3. Invio a Giobby prenotato in modo atomico (`in_invio`) + indici univoci nel DB: due conferme concorrenti = un solo carico
4. Stesso n°+data ma fornitore letto diversamente: solo avviso
Se il processo si interrompe durante l'invio il DDT resta `in_invio`: controllare su Giobby prima di reinviare.

## Watcher
`npm run watcher` usa chokidar con `awaitWriteFinish` (file invariato per WATCH_STABILITY_MS prima di leggerlo) + controllo d'integrità del PDF (header e `%%EOF`). Su cartelle di rete SMB/NFS: `WATCH_POLLING=true`. L'upload da browser usa una cartella separata (`data/upload`), non osservata dal watcher.

## Da fare
- [ ] src/giobby.js: ApiGiobby (endpoint, auth, mapping) appena disponibile la doc API
- [ ] Provare l'estrazione su DDT reali e tarare il prompt in src/extractor.js
- [ ] Scansione da stampante verso data/inbox (cartella condivisa o mail)
