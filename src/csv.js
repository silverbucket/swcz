// Server-side access to the shared CSV import parser (site/csvimport.js).
import '../site/csvimport.js';
export const { parseText, parseBytes, decodeBytes, looksLikeCsv, sniffDelimiter } = globalThis.SWCsv;
