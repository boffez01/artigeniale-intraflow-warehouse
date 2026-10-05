import { z } from 'zod';

export const RigaSchema = z.object({
  codice_articolo: z.string().nullish().transform((v) => v ?? null),
  descrizione: z.string().nullish().transform((v) => v ?? null),
  quantita: z.number().nullish().transform((v) => v ?? null),
  unita_misura: z.string().nullish().transform((v) => v ?? null),
  lotto: z.string().nullish().transform((v) => v ?? null),
  data_scadenza: z.string().nullish().transform((v) => v ?? null), // ISO YYYY-MM-DD
  campi_incerti: z.array(z.string()).nullish().transform((v) => v ?? []),
});

export const DdtSchema = z.object({
  fornitore: z.string().nullish().transform((v) => v ?? null),
  partita_iva_fornitore: z.string().nullish().transform((v) => v ?? null),
  cliente: z.string().nullish().transform((v) => v ?? null),
  numero_ddt: z.string().nullish().transform((v) => v ?? null),
  data_ddt: z.string().nullish().transform((v) => v ?? null), // ISO YYYY-MM-DD
  numero_ordine_cliente: z.string().nullish().transform((v) => v ?? null),
  righe: z.array(RigaSchema).nullish().transform((v) => v ?? []),
});

export const emptyDdt = () => DdtSchema.parse({});
