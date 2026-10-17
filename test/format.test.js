import { describe, it, expect } from 'vitest';
import { markdownTable } from '../src/format.js';

describe('markdownTable', () => {
    it('says so when there are no rows', () => {
        expect(markdownTable([])).toMatch(/no rows/);
    });

    it('prints BigInt H3 ids in full, rounds floats, and escapes pipes', () => {
        const out = markdownTable([{ h: 622203768917753855n, x: 1 / 3, s: 'a|b', z: null }]);
        expect(out.split('\n')[2]).toBe('| 622203768917753855 | 0.333333 | a\\|b |  |');
    });
});
