import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPClient, PostMessageTransport, isFailedToolResult } from '../vendor/glen-harness/index.js';
import { createServer, MAX_ROWS } from '../src/server.js';

// The worker's server with a stub engine, reached the way the page reaches it:
// glen-harness's MCPClient over a PostMessageTransport. A MessageChannel stands
// in for page ↔ Worker.

const stubEngine = {
    instructions: 'Tables for county 06001.',
    describe: async () => [{ table: 'places', description: 'Census places', rows: 2, columns: ['NAME VARCHAR'] }],
    query: async (sql) => {
        if (/fail/.test(sql)) throw new Error('Parser Error: syntax error');
        if (/many/.test(sql)) return Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ i }));
        return [{ NAME: 'Oakland', h10: 622203768917753855n, n: 3 }];
    },
};

let consoleSpies, mcp, port1;
beforeEach(async () => {
    consoleSpies = ['log', 'warn', 'error'].map(m => vi.spyOn(console, m).mockImplementation(() => {}));
    const channel = new MessageChannel();
    port1 = channel.port1;
    await createServer(stubEngine).connect(new PostMessageTransport(channel.port2));
    mcp = new MCPClient('worker:test', {}, { transport: () => new PostMessageTransport(port1) });
    await mcp.connect();
});
afterEach(async () => {
    await mcp.disconnect();
    port1.close();
    consoleSpies.forEach(s => s.mockRestore());
});

describe('in-browser MCP server', () => {
    it('offers list_datasets and query, and sends its instructions in the handshake', () => {
        expect(mcp.getTools().map(t => t.name)).toEqual(['list_datasets', 'query']);
        expect(mcp.client.getInstructions()).toBe('Tables for county 06001.');
    });

    it('lists the datasets', async () => {
        const out = JSON.parse(await mcp.callTool('list_datasets', {}));
        expect(out[0]).toMatchObject({ table: 'places', rows: 2 });
    });

    it('returns query rows as a markdown table, with H3 ids in full', async () => {
        const out = await mcp.callTool('query', { sql_query: 'SELECT NAME FROM places' });
        expect(out).toContain('| NAME | h10 | n |');
        expect(out).toContain('| Oakland | 622203768917753855 | 3 |');
    });

    it('accepts the sql alias, as mcp-data-server does', async () => {
        expect(await mcp.callTool('query', { sql: 'SELECT 1' })).toContain('Oakland');
    });

    it('reports a failed query as "SQL Error:", which glen-harness counts as a failure', async () => {
        const out = await mcp.callTool('query', { sql_query: 'fail' });
        expect(out).toBe('SQL Error: Parser Error: syntax error');
        expect(isFailedToolResult({ result: out })).toBe(true);
    });

    it('caps long results and says so', async () => {
        const out = await mcp.callTool('query', { sql_query: 'many' });
        expect(out.split('\n').filter(l => l.startsWith('| ')).length).toBe(MAX_ROWS + 2); // header, separator, rows
        expect(out).toContain(`(${MAX_ROWS + 5} rows; first ${MAX_ROWS} shown`);
    });
});
