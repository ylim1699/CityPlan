/* Shapes shared by the model, the routing worker and the UI. */
export type XZ = [number, number];
export type Meta = { source: string; url: string; fetched: string; type: 'real' | 'national-average' | 'estimate' };
export type Source = { label: string; url: string };

/* city-rexburg.json from scripts/build_city.py (integer meters east/south of the origin) */
export type OsmCity = {
  name: string; origin: [number, number]; kx: number; kz: number; bbox: number[]; fetched: string;
  names: string[]; cls: string[];
  roads: [number, number, number, number, number[], number[], number, number, number, number[], number[], number, number][];  /* ..., mph, 1 if the speed limit is tagged in OSM */
  classAdt: Record<string, number>;
  counts: { used: number; records: number; growth: number; pts: [number, number, number, number, number?, number?][];
    approach?: [number, number, number, number, number, number, string, string][] }; // x, z, aadt, year, segment, aadt grown to 2026
  buildings: number[][]; lots: number[][]; parks: number[][]; water: number[][]; waterways: number[][]; rail: number[][];
  campus: number[]; walk: number[]; ped: number[] | null;
  widenings: { id: string; name: string; desc: string; start: string | null; impact: string | null; rings: number[][] }[];
  streetplan: { id: string; name: string; type: string | null; year: number; cost: number | null; where: string; lines: number[][] }[];
  foot: Record<string, [XZ, XZ]>; strips: Record<string, number[][]>;
  signals?: [number, number, number][];  /* x, z, OSM traffic_signals nodes at the intersection */
  places: Record<string, XZ>;
  parking: { lots: number; spacesAll: number; lotsNear: number; spacesNear: number; perSpace: number };
  stats: Record<string, unknown>;
  meta?: Meta;
};

export type Effect = { names: string[]; ll: [number, number]; rM: number; during: number; after: number; near?: XZ; r?: number };
export type Project = {
  id: string; name: string; type: string; status: 'construction' | 'approved' | 'planned';
  start: number; end: number; size: string; where: string; plain: string; evidence: string;
  source: Source; confidence: 'high' | 'medium' | 'low'; flags: string[];
  trips?: number; tripBasis?: string; units?: number; beds?: number; sqft?: number; parkRate?: number;
  phased?: boolean; unconfirmed?: boolean; fid?: string; hM?: number; n?: number; sid?: string; ll?: [number, number];
  footM?: [number, number];  /* footprint in meters for a project placed by a reviewer (no mapped footprint): drawn as n blocks hM tall */
  lines?: number[][]; effects?: Effect[];
  foundBy?: 'agent' | 'person'; reviewed?: boolean; foundIn?: Source;
  /* filled in by createAtlas */
  pos?: XZ; foot?: XZ; h?: number; strips?: XZ[][]; _w?: number[]; _ws?: number;
};
/* blockgroups.json from scripts/build_blockgroups.py: Census block groups with their published figures (rings in meters, like the city file).
   ACS values are 5-year estimates with 90% margins of error (…Moe); pop2020 is the 2020 Census full count; null = not published */
export type BlockGroup = {
  id: string; name: string; rings: number[][]; at: [number, number]; landKm2: number; waterKm2: number;
  pop2020: number | null; pop: number | null; popMoe: number | null; homes: number | null; homesMoe: number | null;
  medAge: number | null; medAgeMoe: number | null; college: number | null; collegeMoe: number | null;
  commute: { workers: number; drive: number; transit: number; bike: number; walk: number; wfh: number } | null;
  cars: { households: number; perHH: number; zeroCar: number } | null;
};
export type BlockGroupsFile = { meta: Meta; notes: string; groups: BlockGroup[] };
export type ProjectsFile ={ meta: Meta; projects: Project[]; unmapped: { name: string; note: string; source: Source }[]; context: { name: string; note: string; source: Source }[] };

export type Params = { enroll: number; stay: number; bedsPerYear: number; unitsPerYear: number; carShare: number;
  S0: number; R0: number; resGrowth: number };  /* fall 2026 students and other residents, and residents' yearly growth: the planner can change them */
export type Fix = { road: string; at: XZ; factor: number; label: string };
export type SegResult = { vol: number; cap: number; vc: number; tti?: number };
