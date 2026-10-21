// Minimal PDF 1.4 writer (no dependencies): A4 pages, Helvetica / Helvetica-Bold (standard fonts, not embedded),
// text, lines, filled rectangles. Czech letters use a custom /Differences encoding onto standard Latin glyph names.
import zlib from 'node:zlib';

const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
// Non-ASCII characters -> [code, glyph name, width]
const EXTRA = {
    'á': 'aacute', 'č': 'ccaron', 'ď': 'dcaron', 'é': 'eacute', 'ě': 'ecaron', 'í': 'iacute', 'ň': 'ncaron', 'ó': 'oacute', 'ř': 'rcaron', 'š': 'scaron', 'ť': 'tcaron', 'ú': 'uacute', 'ů': 'uring', 'ý': 'yacute', 'ž': 'zcaron',
    'Á': 'Aacute', 'Č': 'Ccaron', 'Ď': 'Dcaron', 'É': 'Eacute', 'Ě': 'Ecaron', 'Í': 'Iacute', 'Ň': 'Ncaron', 'Ó': 'Oacute', 'Ř': 'Rcaron', 'Š': 'Scaron', 'Ť': 'Tcaron', 'Ú': 'Uacute', 'Ů': 'Uring', 'Ý': 'Yacute', 'Ž': 'Zcaron',
    'ä': 'adieresis', 'ö': 'odieresis', 'ü': 'udieresis', 'Ä': 'Adieresis', 'Ö': 'Odieresis', 'Ü': 'Udieresis', 'ß': 'germandbls', 'ľ': 'lcaron', 'ĺ': 'lacute', 'ô': 'ocircumflex', 'ŕ': 'racute',
    '–': 'endash', '—': 'emdash', '·': 'periodcentered', '•': 'bullet', '„': 'quotedblbase', '“': 'quotedblleft', '”': 'quotedblright', '‘': 'quoteleft', '’': 'quoteright', '§': 'section', '…': 'ellipsis', '°': 'degree', '€': 'Euro', '×': 'multiply',
};
const CHARS = Object.keys(EXTRA);
export const PDF_CHARS = CHARS;
const CODE = Object.fromEntries(CHARS.map((c, i) => [c, 128 + i]));
const widthOf = (c) => { const k = c.charCodeAt(0); if (k >= 32 && k <= 126) return W[k - 32]; if (CODE[c] !== undefined) { const base = c.normalize('NFD')[0]; const b = base.charCodeAt(0); return b >= 32 && b <= 126 ? W[b - 32] : 556; } return 556; };
const clean = (s) => String(s ?? '').replace(/→/g, '->').replace(/\u00a0|\u202f/g, ' ').split('').map((c) => (c.charCodeAt(0) < 127 && c.charCodeAt(0) >= 32) || CODE[c] !== undefined ? c : (c.normalize('NFD')[0].charCodeAt(0) < 127 ? c.normalize('NFD')[0] : '?')).join('');
const enc = (s) => clean(s).split('').map((c) => { const k = CODE[c]; if (k !== undefined) return `\\${k.toString(8)}`; return c === '(' || c === ')' || c === '\\' ? `\\${c}` : c; }).join('');

export function textWidth(s, size, bold = false) { return (clean(s).split('').reduce((n, c) => n + widthOf(c), 0) * size / 1000) * (bold ? 1.08 : 1.04); }
export function wrap(s, size, maxW, bold = false) {
    const out = [];
    for (const para of String(s ?? '').split('\n')) {
        let line = '';
        for (const word of para.split(/\s+/)) {
            const t = line ? `${line} ${word}` : word;
            if (textWidth(t, size, bold) <= maxW || !line) line = t; else { out.push(line); line = word; }
            while (textWidth(line, size, bold) > maxW && line.length > 1) { let k = line.length; while (k > 1 && textWidth(line.slice(0, k), size, bold) > maxW) k--; out.push(line.slice(0, k)); line = line.slice(k); }
        }
        out.push(line);
    }
    return out;
}

export class Pdf {
    constructor({ title = 'Document', margin = 48 } = {}) { this.pages = []; this.title = title; this.margin = margin; this.w = 595.28; this.h = 841.89; this.footer = null; this.addPage(); }
    addPage() { this.cur = []; this.pages.push(this.cur); this.y = this.h - this.margin; return this; }
    ensure(h) { if (this.y - h < this.margin + 20) this.addPage(); return this; }
    rgb(c) { const [r, g, b] = c; return `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)}`; }
    text(x, y, s, { size = 10, bold = false, color = [20, 32, 43] } = {}) { this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${this.rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${enc(s)}) Tj ET`); return this; }
    rect(x, y, w, h, color) { this.cur.push(`${this.rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); return this; }
    line(x1, y1, x2, y2, color = [210, 216, 222], width = 0.6) { this.cur.push(`${this.rgb(color)} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`); return this; }
    /** Flowing paragraph at the current y; returns this. */
    para(s, { size = 10, bold = false, color, x = this.margin, width = this.w - 2 * this.margin, gap = 4, lead = 1.35 } = {}) {
        for (const l of wrap(s, size, width, bold)) { this.ensure(size * lead); this.y -= size * lead; this.text(x, this.y, l, { size, bold, color }); }
        this.y -= gap; return this;
    }
    /** Table row: cells [{ text, width, bold, color, bg }]; wraps each cell; draws a bottom rule. */
    row(cells, { size = 8.5, pad = 3, bg, rule = true } = {}) {
        const lines = cells.map((c) => wrap(c.text, c.size ?? size, c.width - 2 * pad, c.bold));
        const h = Math.max(...lines.map((l) => l.length)) * size * 1.3 + 2 * pad;
        if (this.y - h < this.margin + 20) { this.addPage(); if (this.onPageBreak) this.onPageBreak(); }
        let x = this.margin;
        if (bg) this.rect(x, this.y - h, cells.reduce((n, c) => n + c.width, 0), h, bg);
        cells.forEach((c, i) => { if (c.bg) this.rect(x, this.y - h, c.width, h, c.bg); lines[i].forEach((l, k) => this.text(x + pad, this.y - pad - (k + 1) * size * 1.3 + size * 0.3, l, { size: c.size ?? size, bold: c.bold, color: c.color })); x += c.width; });
        this.y -= h; if (rule) this.line(this.margin, this.y, x, this.y); return this;
    }
    toBuffer() {
        const objs = []; const add = (s) => { objs.push(s); return objs.length; };
        const diff = `/Differences [128 ${CHARS.map((c) => `/${EXTRA[c]}`).join(' ')}]`;
        const encId = add(`<< /Type /Encoding /BaseEncoding /WinAnsiEncoding ${diff} >>`);
        const f1 = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${encId} 0 R >>`);
        const f2 = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding ${encId} 0 R >>`);
        const pagesId = objs.length + 1; objs.push(null);
        const kids = [];
        this.pages.forEach((ops, i) => {
            const foot = this.footer ? [`BT /F1 7.5 Tf 0.45 0.5 0.55 rg ${this.margin} 28 Td (${enc(`${this.footer}  ·  page ${i + 1} of ${this.pages.length}`)}) Tj ET`] : [];
            const data = zlib.deflateSync(Buffer.from([...ops, ...foot].join('\n'), 'latin1'));
            const cid = add({ stream: data });
            kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.w} ${this.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cid} 0 R >>`));
        });
        objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
        const info = add(`<< /Title (${enc(this.title)}) /Producer (Supplier Watch) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
        const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
        const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]; const offs = []; let len = parts[0].length;
        objs.forEach((o, i) => {
            offs.push(len);
            const b = typeof o === 'string' ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')
                : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${o.stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
            parts.push(b); len += b.length;
        });
        const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${info} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
        parts.push(Buffer.from(xref, 'latin1'));
        return Buffer.concat(parts);
    }
}
