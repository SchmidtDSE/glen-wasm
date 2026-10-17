# glen-wasm

A prototype of a GLEN MCP data server that runs inside the browser. DuckDB-wasm runs in a Web Worker, loads one California county's H3 hex datasets, and serves MCP tools to the page. The page runs the [glen-harness](https://github.com/SchmidtDSE/glen-harness) agent loop and reaches the worker over `postMessage`, not HTTP. No server of ours is involved: the page, the worker and the data files are static, and the only party that sees the user's questions is the language model endpoint the user chooses.

## How it fits together

```
page (index.html, src/app.js)
  glen-harness Agent ──── HTTPS ────▶ OpenAI-compatible model endpoint
        │
  MCPClient + PostMessageTransport
        │  postMessage (MCP JSON-RPC)
        ▼
Web Worker (src/worker.js, src/server.js)
  MCP server: list_datasets, query
        │
  DuckDB-wasm (its own worker) ◀── county parquet files, fetched once at start
```

- **The worker is the server's container.** Its only interface is `postMessage`, and the page talks to it only in MCP. This is the browser counterpart of an MCP server in a Docker container behind a TCP port.
- **The tools match mcp-data-server's.** `query` takes `sql_query` and reports failures as `SQL Error: …`, so glen-harness handles both servers the same way. `list_datasets` describes the loaded tables.
- **The model's SQL cannot reach the network or files.** After loading the tables, the worker sets DuckDB's `enable_external_access = false` and locks the configuration. A query that tries to read a URL, or to turn access back on, fails.
- **The data are small per-county copies.** Each dataset is one parquet file per county from the [tpl-cities browser tile set](https://github.com/boettiger-lab/tpl-cities/blob/main/notes/in-browser.md), a few hundred kilobytes to a few megabytes. Reading the national hex files directly from a browser is too slow, so the tiles are what make this practical.

## Datasets

Eight tables, each one row per H3 cell (resolution 10, or 9 for wildfire hazard) per feature: ACS 2020–2024 block groups, Census 2024 tracts and places, CalEnviroScreen 5.0, DWR disadvantaged communities (2023), CAL FIRE fire perimeters, USFS Wildfire Hazard Potential (2023), and FEMA flood hazard zones. `src/datasets.js` lists them with the guidance the server sends to the model.

## Try it

Serve the repository as static files and open it:

```bash
python3 -m http.server 8000
# http://localhost:8000/?county=06001
```

Enter an OpenAI-compatible endpoint, a model name and an API key, then **Start**. Alameda County loads in about 2.5 seconds. The key stays in the page's memory; the endpoint and model name are remembered in the browser.

## Checks

- `pnpm test` runs the server over a `MessageChannel` with glen-harness's `MCPClient`, using a stub in place of DuckDB.
- `node scripts/e2e.mjs` runs the page in headless Chrome against a scripted stand-in for the model, so no API key is needed. It checks that the worker starts and loads all eight tables, that a full agent turn runs (model → `list_datasets` → `query` → answer), that numbers come back correctly, and that SQL cannot read a URL. CI runs it on every push.

## Vendored code

The page and the worker load everything by relative path from the same origin, apart from DuckDB-wasm itself (pinned, from jsDelivr):

- `vendor/glen-harness/`: glen-harness at the commit in `HARNESS_REF`, copied by `pnpm run vendor:harness`.
- `vendor/mcp-server-sdk.js`: the server half of the MCP SDK 1.12.0, bundled by `pnpm run build:vendor`.

CI regenerates both and fails if they differ from what is committed. Development dependencies are installed with pnpm, which runs no dependency install scripts and installs no version less than a week old (`pnpm-workspace.yaml`).

## Limits of the prototype

- **One county at a time, with fixed tables.** An agent cannot reach data outside the tiles the page loaded. A general version would need the server to choose tiles from the question, or a tile scheme finer than counties.
- **DuckDB-wasm and its h3 extension come from jsDelivr and DuckDB's extension repository** at start-up. An offline version would serve them from the same origin.
- **Answers are shown as plain text,** so markdown tables are not rendered.

## License

Apache-2.0. See [LICENSE](LICENSE) and [DISCLOSURE.md](DISCLOSURE.md).
