import { z } from 'zod';

const txt = () => z.string().nullish().transform((v) => v ?? null);

export const RigaSchema = z.object({
  codice_articolo: txt(),
  descrizione: txt(),
  quantita: z.number().nullish().transform((v) => v ?? null),
  unita_misura: txt(),
  lotto: txt(),
  data_scadenza: txt(), // ISO AAAA-MM-GG (o AAAA-MM / MM/AAAA in ingresso: la normalizzazione la porta a fine mese)
  scadenza_a_fine_mese: z.boolean().nullish().transform((v) => v ?? false), // scritta solo mese/anno: giorno assunto
  campi_incerti: z.array(z.string()).nullish().transform((v) => v ?? []),
});

export const DdtSchema = z.object({
  fornitore: txt(),
  partita_iva_fornitore: txt(),
  cliente: txt(),
  numero_ddt: txt(),
  data_ddt: txt(), // ISO AAAA-MM-GG
  numero_ordine_cliente: txt(),
  causale_trasporto: txt(),
  pagina_inizio: z.number().int().positive().nullish().transform((v) => v ?? 1), // pagina del PDF dove inizia il DDT
  righe: z.array(RigaSchema).nullish().transform((v) => v ?? []),
});

// Un file (PDF multipagina) può contenere più DDT.
export const EstrazioneSchema = z.object({
  documenti: z.array(DdtSchema).nullish().transform((v) => v ?? []),
});

export const emptyDdt = () => DdtSchema.parse({});