/**
 * Render query rows as a markdown table for the model.
 *
 * BigInt values (H3 cell ids are UBIGINT) print as integers, not in exponent
 * form, which would lose digits. At most `maxRows` rows are shown, with a note
 * when more were returned.
 */
export function markdownTable(rows, maxRows = 200) {
    if (!rows.length) return 'Query executed successfully but returned no rows.';
    const cols = Object.keys(rows[0]);
    const cell = (v) => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'bigint') return v.toString();
        if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(6));
        if (v instanceof Date) return v.toISOString();
        if (typeof v === 'object') return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
        return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    };
    const shown = rows.slice(0, maxRows);
    const lines = [
        `| ${cols.join(' | ')} |`,
        `| ${cols.map(() => '---').join(' | ')} |`,
        ...shown.map(r => `| ${cols.map(c => cell(r[c])).join(' | ')} |`),
    ];
    if (rows.length > maxRows) lines.push('', `(${rows.length} rows; first ${maxRows} shown. Aggregate or add LIMIT.)`);
    return lines.join('\n');
}
