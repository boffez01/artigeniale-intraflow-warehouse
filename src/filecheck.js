// Controllo d'integrità del file PRIMA di mandarlo a Gemini (difesa in più rispetto al watcher).
import fs from 'node:fs';
import path from 'node:path';

export function fileCompleto(filePath) {
  const { size } = fs.statSync(filePath);
  if (size === 0) return false;
  if (path.extname(filePath).toLowerCase() !== '.pdf') return true;
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, 0);
    if (head.toString('latin1') !== '%PDF-') return false;
    const n = Math.min(2048, size);
    const tail = Buffer.alloc(n);
    fs.readSync(fd, tail, 0, n, size - n);
    return tail.toString('latin1').includes('%%EOF'); // un PDF scritto a metà non ha il trailer
  } finally {
    fs.closeSync(fd);
  }
}
