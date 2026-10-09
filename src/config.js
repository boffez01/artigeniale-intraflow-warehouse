import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  port: Number(process.env.PORT || 3000),
  dataDir,
  inboxDir: path.join(dataDir, 'inbox'),       // SOLO la stampante/scanner scrive qui (la guarda il watcher)
  uploadDir: path.join(dataDir, 'upload'),     // upload da browser: cartella separata, non osservata dal watcher
  archiveDir: path.join(dataDir, 'archivio'),  // DDT già acquisiti
  outboxDir: path.join(dataDir, 'outbox'),     // dryrun: payload che andrebbero a Giobby
  watchPolling: process.env.WATCH_POLLING === 'true',          // true per cartelle di rete SMB/NFS
  watchStabilityMs: Number(process.env.WATCH_STABILITY_MS || 3000), // file fermo da N ms = scrittura finita
  dbPath: path.join(dataDir, 'ddt.sqlite3'),
  giobbyMode: process.env.GIOBBY_MODE || 'dryrun',
  // Giobby, login "api-server" (https://www.giobby.com/apidoc/). Le credenziali stanno SOLO nel .env.
  giobbyAuthUrl: (process.env.GIOBBY_AUTH_URL || 'https://auth.giobby.com/auth').replace(/\/+$/, ''),
  giobbyEndpointUrl: process.env.GIOBBY_ENDPOINT_URL || 'https://app.giobby.com/GiobbyApiLogin/v1/endpoint',
  giobbyRealm: process.env.GIOBBY_REALM || 'api-server',
  giobbyClientId: process.env.GIOBBY_CLIENT_ID || '',
  giobbyUser: process.env.GIOBBY_USER || '',
  giobbyCid: process.env.GIOBBY_CID || '',
  giobbyPassword: process.env.GIOBBY_PASSWORD || '',
  giobbyBaseUrl: (process.env.GIOBBY_BASE_URL || '').replace(/\/+$/, ''), // facoltativo: forza l'indirizzo delle API
};

for (const d of [config.inboxDir, config.uploadDir, config.archiveDir, config.outboxDir]) {
  fs.mkdirSync(d, { recursive: true });
}