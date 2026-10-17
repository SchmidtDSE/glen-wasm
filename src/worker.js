/**
 * Web Worker entry: the MCP data server, running in the browser.
 *
 * Starts DuckDB-wasm, loads one county's tables, then serves MCP over
 * postMessage. The page connects with glen-harness's MCPClient and a
 * PostMessageTransport to this worker; the worker has no other interface.
 *
 * The county comes from the worker URL: worker.js?county=06001.
 */

import { PostMessageTransport } from '../vendor/glen-harness/post-message-transport.js';
import { createServer } from './server.js';
import { DATASETS, TILES_URL, instructions } from './datasets.js';

const DUCKDB = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0';

const DECIMAL = 7; // apache-arrow Type.Decimal

/** An unscaled decimal string as a BigInt (scale 0, exact) or a Number. */
function decimal(digits, scale) {
    return scale === 0 ? BigInt(digits) : Number(digits) / 10 ** scale;
}

const county = new URL(self.location.href).searchParams.get('county') ?? '06001';

// Listen now: the page sends `initialize` straight away, and the transport
// queues it until the server connects, once the tables are loaded.
const transport = new PostMessageTransport(self);

start()
    .catch((err) => {
        console.error('[glen-wasm] failed to start', err);
        const fail = async () => { throw new Error(`DuckDB did not start: ${err.message}`); };
        return { instructions: instructions(county), describe: fail, query: fail };
    })
    .then((engine) => createServer(engine).connect(transport));

async function start() {
    if (!/^06\d{3}$/.test(county)) throw new Error(`not a California county FIPS code: ${county}`);

    const duckdb = await import(`${DUCKDB}/+esm`);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    // DuckDB runs in its own worker, started from here.
    const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const conn = await db.connect();
    await conn.query('INSTALL h3 FROM community; LOAD h3;');

    // Fetch every county file in parallel and load it into a table. Reading
    // whole small files beats DuckDB-wasm's one-range-request-at-a-time reads.
    await Promise.all(DATASETS.map(async (d) => {
        const res = await fetch(`${TILES_URL}/${d.path}/${county}.parquet`);
        if (!res.ok) throw new Error(`${d.table}: HTTP ${res.status}`);
        await db.registerFileBuffer(`${d.table}.parquet`, new Uint8Array(await res.arrayBuffer()));
    }));
    for (const d of DATASETS) {
        await conn.query(`CREATE TABLE ${d.table} AS SELECT * EXCLUDE (h0) FROM read_parquet('${d.table}.parquet')`);
        await db.dropFile(`${d.table}.parquet`);
    }

    // The tables are loaded, so the model's SQL needs no file or network
    // access. Turn it off and lock the setting: a query cannot read a URL, or
    // send data out in one.
    await conn.query('SET enable_external_access = false; SET lock_configuration = true;');

    const rows = async (sql) => {
        const table = await conn.query(sql);
        // Arrow hands DECIMAL (and HUGEINT, as DECIMAL(38,0)) back as unscaled
        // big integers; apply the scale. SUM over an integer column is HUGEINT.
        const decimals = table.schema.fields
            .filter(f => f.type.typeId === DECIMAL)
            .map(f => [f.name, f.type.scale]);
        return table.toArray().map((r) => {
            const row = r.toJSON();
            for (const [name, scale] of decimals) {
                if (row[name] != null) row[name] = decimal(String(row[name]), scale);
            }
            return row;
        });
    };

    const described = await Promise.all(DATASETS.map(async (d) => ({
        table: d.table,
        description: d.description,
        rows: Number((await rows(`SELECT count(*) AS n FROM ${d.table}`))[0].n),
        columns: (await rows(`DESCRIBE ${d.table}`)).map(c => `${c.column_name} ${c.column_type}`),
    })));

    return {
        instructions: instructions(county),
        describe: async () => described,
        query: rows,
    };
}
