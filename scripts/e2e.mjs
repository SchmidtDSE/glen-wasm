#!/usr/bin/env node
// End-to-end check in headless Chrome: the page starts the worker, DuckDB-wasm
// loads a county, and glen-harness's agent loop runs against a scripted
// stand-in for the language model (no API key needed). Also checks that the
// worker refuses SQL that reads a URL.
//
//   CHROME=/path/to/chrome node scripts/e2e.mjs [county]
//   SITE_URL=https://schmidtdse.github.io/glen-wasm/ node scripts/e2e.mjs
//
// Against the deployed page, the checks up to the agent turn apply: Chrome
// blocks a public https page from calling the scripted model on 127.0.0.1
// (Private Network Access), as it would block any site probing localhost.
//
// Network: the page fetches DuckDB-wasm from jsDelivr and the county files
// from source.coop, as it does for users.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME
    ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const COUNTY = process.argv[2] ?? '06001';
const SQL = `SELECT DAC23, SUM(Pop23) AS people FROM (SELECT DISTINCT _cng_fid, DAC23, Pop23 FROM disadvantaged_communities) GROUP BY DAC23 ORDER BY DAC23`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const listen = (server) => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));

// Static files, as GitHub Pages would serve them.
const site = await listen(http.createServer(async (req, res) => {
    let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (file.endsWith('/')) file = path.join(file, 'index.html');
    try {
        const body = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
}));

// Scripted model: list_datasets, then one query, then an answer quoting it.
const requests = [];
const llm = await listen(http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    let b = '';
    req.on('data', d => b += d);
    req.on('end', () => {
        const { messages } = JSON.parse(b);
        requests.push(messages);
        const toolTurns = messages.filter(m => m.role === 'tool').length;
        const call = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: `c${toolTurns}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
        const message = toolTurns === 0 ? call('list_datasets', {})
            : toolTurns === 1 ? call('query', { sql_query: SQL })
            : { role: 'assistant', content: `From disadvantaged_communities:\n${messages.at(-1).content}` };
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
            .end(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] }));
    });
}));

const profile = await fs.mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'glen-wasm-e2e-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
    chrome.stderr.on('data', d => { const m = String(d).match(/ws:\/\/\S+/); if (m) resolve(m[0]); });
    chrome.on('exit', c => reject(new Error(`chrome exited ${c}`)));
});
const port = new URL(wsUrl).port;
let page;
for (let i = 0; i < 50 && !page; i++) {
    page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
    if (!page) await new Promise(r => setTimeout(r, 100));
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || process.env.DEBUG)) {
        console.log(`  [page ${msg.params.type}]`, msg.params.args.map(a => a.value ?? a.description).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        console.log('  [page log]', msg.params.entry.text, msg.params.entry.url ?? '');
    }
    if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        console.log('  [page exception]', d.exception?.description ?? d.text, d.url ?? '');
    }
});
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
    const { result } = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return result.result.value;
};

let failed = false;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed = true; };

try {
    await cdp('Runtime.enable');
    await cdp('Log.enable');
    await cdp('Page.enable');
    const base = process.env.SITE_URL ?? `http://127.0.0.1:${site}/`;
    await cdp('Page.navigate', { url: `${base}?county=${COUNTY}` });
    // Module scripts, with their imports, have run once the document is complete.
    for (let i = 0; i < 100 && (await evaluate('document.readyState')) !== 'complete'; i++) {
        await new Promise(r => setTimeout(r, 100));
    }

    const started = await evaluate(`(async () => {
        document.getElementById('endpoint').value = 'http://127.0.0.1:${llm}/v1';
        document.getElementById('model').value = 'scripted';
        const t0 = performance.now();
        document.getElementById('start').click();
        while (!window.__glen) {
            if (performance.now() - t0 > 120000) throw new Error('timed out: ' + document.getElementById('status').textContent);
            await new Promise(r => setTimeout(r, 200));
        }
        return { seconds: (performance.now() - t0) / 1000, status: document.getElementById('status').textContent };
    })()`);
    console.log(`     ${started.status}`);
    check(/tools list_datasets, query/.test(started.status), 'worker started and listed its tools');

    const datasets = JSON.parse(await evaluate(`window.__glen.mcp.callTool('list_datasets', {})`));
    check(datasets.length === 8 && datasets.every(d => d.rows > 0), `8 tables loaded (${datasets.map(d => `${d.table} ${d.rows}`).join(', ')})`);

    const out = await evaluate(`window.__glen.agent.processMessage('How many people live in disadvantaged communities?')`);
    console.log(out.response.split('\n').map(l => `     ${l}`).join('\n'));
    check(/\| DAC23 \| people \|/.test(out.response) && /\| Y \| \d+ \|/.test(out.response), 'agent loop: model → list_datasets → query → answer');
    check(out.sqlQueries.length === 1 && out.sqlQueries[0] === SQL, 'the query was recorded');
    check(requests[0][0].content.includes(`county ${COUNTY}`), 'server instructions reached the system prompt');

    if (process.env.SCREENSHOT) {
        // The page as it stands after the turn, at desktop and phone widths.
        await evaluate(`(() => { const e = document.createElement('div'); e.className = 'entry answer';
            e.innerHTML = '<div class=label>Answer</div><div class=body></div>';
            e.querySelector('.body').textContent = ${JSON.stringify(out.response)};
            document.getElementById('log').append(e); })()`);
        for (const [name, width, height] of [['desktop', 1200, 1100], ['phone', 390, 1400]]) {
            await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name === 'phone' });
            const { result } = await cdp('Page.captureScreenshot', { format: 'png' });
            const file = path.join(process.env.SCREENSHOT, `${name}.png`);
            await fs.writeFile(file, Buffer.from(result.data, 'base64'));
            console.log(`     screenshot ${file}`);
        }
    }

    const nums = await evaluate(`window.__glen.mcp.callTool('query', { sql_query: "SELECT SUM(Pop23) AS total, CAST(1.25 AS DECIMAL(10,2)) AS d FROM disadvantaged_communities" })`);
    check(/\| \d+ \| 1\.25 \|/.test(nums), `integer sums and decimals print as numbers (${nums.split('\n')[2]})`);

    const blocked = await evaluate(`window.__glen.mcp.callTool('query', { sql_query: "SELECT * FROM read_csv('https://example.org/x.csv')" })`);
    check(/^SQL Error:/.test(blocked), `SQL cannot read a URL (${blocked.slice(0, 90)}…)`);

    const unlock = await evaluate(`window.__glen.mcp.callTool('query', { sql_query: "SET enable_external_access = true" })`);
    check(/^SQL Error:/.test(unlock), `nor turn that back on (${unlock.slice(0, 90)}…)`);
} catch (err) {
    console.log('FAIL', err.message);
    failed = true;
} finally {
    ws.close();
    chrome.kill();
    await new Promise(r => chrome.once('exit', r));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
    process.exit(failed ? 1 : 0);
}
