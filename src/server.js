/**
 * The MCP server: two tools over a SQL engine, with no knowledge of where the
 * engine runs. worker.js gives it DuckDB-wasm inside a Web Worker; tests give
 * it a stub.
 *
 * Tool names and the `SQL Error:` convention match mcp-data-server, so
 * glen-harness treats both servers alike.
 */

import { Server, ListToolsRequestSchema, CallToolRequestSchema } from '../vendor/mcp-server-sdk.js';
import { markdownTable } from './format.js';

export const MAX_ROWS = 200;

const TOOLS = [
    {
        name: 'list_datasets',
        description: 'List the tables loaded in the browser, with descriptions, row counts and columns.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'query',
        description: `Run one DuckDB SQL query against the loaded tables and return the result as a markdown table (at most ${MAX_ROWS} rows).`,
        inputSchema: {
            type: 'object',
            properties: { sql_query: { type: 'string', description: 'DuckDB SQL' } },
            required: ['sql_query'],
        },
    },
];

/**
 * @param {Object} engine
 * @param {(sql: string) => Promise<Object[]>} engine.query - rows as plain objects
 * @param {() => Promise<Array<{table, description, rows, columns}>>} engine.describe
 * @param {string} engine.instructions
 */
export function createServer(engine) {
    const server = new Server(
        { name: 'glen-wasm', version: '0.1.0' },
        { capabilities: { tools: {} }, instructions: engine.instructions },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const { name, arguments: args = {} } = req.params;
        if (name === 'list_datasets') {
            return text(JSON.stringify(await engine.describe(), null, 1));
        }
        if (name === 'query') {
            const sql = args.sql_query ?? args.sql ?? args.query;
            if (typeof sql !== 'string' || !sql.trim()) return text('SQL Error: no sql_query given');
            try {
                const rows = await engine.query(sql);
                return text(markdownTable(rows, MAX_ROWS));
            } catch (err) {
                return text(`SQL Error: ${err.message}`);
            }
        }
        return text(`Error: unknown tool ${name}`);
    });

    return server;
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });
