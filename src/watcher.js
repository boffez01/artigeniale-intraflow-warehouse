// Osserva la cartella inbox (dove la stampante salva le scansioni) e acquisisce i nuovi DDT.
// Avvio:  npm run watcher
//
// I multifunzione scrivono i PDF in più secondi: chokidar con awaitWriteFinish emette l'evento
// solo quando la dimensione del file resta invariata per `stabilityThreshold` ms.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import chokidar from 'chokidar';
import { config } from './config.js';
import { ingest } from './service.js';

const EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const TEMP = /(^|[/\\])\.|(\.(tmp|part|crdownload)|~)$/i; // file nascosti e temporanei

const ingestEStampa = async (p) => {
  const r = await ingest(p);
  console.log('Acquisito', path.basename(p), '->', r ? `#${r.id}${r.duplicato ? ' (già presente)' : ''}` : 'saltato');
};

export function startWatcher({
  dir = config.inboxDir,
  onFile = ingestEStampa,
  stabilityThreshold = config.watchStabilityMs,
  pollInterval = 500,
  usePolling = config.watchPolling,
} = {}) {
  const watcher = chokidar.watch(dir, {
    depth: 0,
    ignoreInitial: false, // processa anche i file arrivati mentre il watcher era spento
    usePolling,
    ignored: (p) => TEMP.test(p),
    awaitWriteFinish: { stabilityThreshold, pollInterval },
  });

  // Coda seriale: un file alla volta, un errore non ferma i successivi.
  let coda = Promise.resolve();
  watcher.on('add', (p) => {
    if (!EXT.has(path.extname(p).toLowerCase())) return;
    coda = coda.then(() => onFile(p)).catch((e) => console.error('Errore su', p, e));
  });
  watcher.on('error', (e) => console.error('Watcher:', e));
  return watcher;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Osservo ${config.inboxDir} (polling=${config.watchPolling}, stabilità=${config.watchStabilityMs}ms)`);
  startWatcher();
}
