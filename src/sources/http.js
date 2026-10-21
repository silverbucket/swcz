// Shared fetch with timeout, retry on 429/5xx, and a polite per-host interval.
const lastByHost = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 20000, retries = 2, minIntervalMs = 250, fetchImpl = fetch } = {}) {
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
        const wait = (lastByHost.get(host) ?? 0) + minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        lastByHost.set(host, Date.now());
        try {
            const res = await fetchImpl(url, { method, headers: { 'User-Agent': 'supplier-risk-monitor/0.1', ...headers }, body, signal: AbortSignal.timeout(timeoutMs) });
            if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
            return { status: res.status, text: await res.text() };
        } catch (e) {
            if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
            throw new Error(`${host}: ${e.cause?.code ?? e.name ?? e.message}`);
        }
    }
}
