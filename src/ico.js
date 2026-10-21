// Czech company ID (IČO) checksum: weights 8..2, mod 11.
export function normaliseIco(s) {
    const d = String(s ?? '').replace(/\D/g, '');
    return d.length > 0 && d.length <= 8 ? d.padStart(8, '0') : null;
}
export function isValidIco(s) {
    const ico = normaliseIco(s);
    if (!ico) return false;
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += Number(ico[i]) * (8 - i);
    const c = (11 - (sum % 11)) % 10;
    return c === Number(ico[7]);
}
