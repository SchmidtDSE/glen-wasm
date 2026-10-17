/**
 * The datasets the in-browser server loads: California-only copies of GLEN's
 * H3 hex datasets, one small parquet file per county, from the tpl-cities
 * browser tile set (tpl-cities/notes/in-browser.md). A county's file holds the
 * county's cells plus some just over its border.
 */

export const TILES_URL = 'https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop/cboettig/tpl-cities/browser-tiles';

export const DATASETS = [
    {
        table: 'acs_blockgroups',
        path: 'public-census/acs-2020-2024/blockgroup/hex',
        description: 'American Community Survey 2020-2024 5-year estimates by census block group. TotPop = total population, MHHI = median household income (USD). GEOID identifies the block group.',
    },
    {
        table: 'census_tracts',
        path: 'public-census/census-2024/tract/hex',
        description: 'Census 2024 tract boundaries. GEOID identifies the tract; ALAND and AWATER are land and water area in square metres.',
    },
    {
        table: 'places',
        path: 'public-census/census-2024/place/hex',
        description: 'Census 2024 places (cities and census-designated places). NAME is the place name, GEOID its identifier.',
    },
    {
        table: 'calenviroscreen',
        path: 'public-calenviroscreen/calenviroscreen-5-0/ces5/hex',
        description: 'CalEnviroScreen 5.0 by census tract. CIscore_Pctl = cumulative pollution-burden and vulnerability score as a statewide percentile (higher is more burdened); Population = tract population; tract = tract number.',
    },
    {
        table: 'disadvantaged_communities',
        path: 'public-ca-dac/dac-2023/tract/hex',
        description: 'California disadvantaged communities (DWR, 2023) by census tract. DAC23 is Y/N; Pop23 = tract population.',
    },
    {
        table: 'fire_perimeters',
        path: 'public-fire/calfire-2025/firep/hex',
        description: 'CAL FIRE historical fire perimeters (2025 release). YEAR_ = fire year; _cng_fid identifies the fire perimeter.',
    },
    {
        table: 'wildfire_hazard',
        path: 'public-fire/whp-2023-classified-conus/hex',
        description: 'USDA Forest Service Wildfire Hazard Potential 2023, classified. whp_class: 1 very low, 2 low, 3 moderate, 4 high, 5 very high, 6 non-burnable, 7 water. Indexed at H3 resolution 9 only (h9, no h10).',
    },
    {
        table: 'flood_hazard',
        path: 'public-hazard/flood-hazard/hex',
        description: 'FEMA flood hazard zones. FLD_ZONE = zone code (A, AE, VE, X, ...); SFHA_TF = T where the cell is in a Special Flood Hazard Area (the 1% annual-chance floodplain).',
    },
];

/** Server instructions, sent to the client in the MCP handshake. */
export function instructions(county) {
    return [
        `DuckDB tables for California county ${county} (state+county FIPS), loaded in the user's browser.`,
        'Each row is one H3 cell of one feature: h10 (resolution 10, ~0.015 km² per cell), with h9 and h8 parents. wildfire_hazard has h9 and h8 only.',
        'A feature\'s attributes repeat on every one of its cells, so do not SUM a feature attribute over rows. Count each feature once, e.g. SELECT SUM(TotPop) FROM (SELECT DISTINCT GEOID, TotPop FROM acs_blockgroups).',
        'Area: COUNT(DISTINCT h10) * 0.015 km². Join datasets on a shared H3 column (h10, or h9 for wildfire_hazard).',
        'The files include some cells just over the county border; filter on a GEOID or county column when the boundary matters.',
        'The DuckDB h3 extension is loaded (h3_cell_to_parent, h3_cell_to_lat, h3_cell_to_lng, ...).',
        'Call list_datasets for columns and row counts, then query with SQL.',
    ].join('\n');
}
