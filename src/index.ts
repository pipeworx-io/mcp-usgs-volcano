interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * USGS Volcano MCP — Volcano Hazards Program HANS-public feed (no auth)
 *
 * Sister to `usgs-earthquake`. Tracks alert status for ~170 US volcanoes
 * (CONUS, Alaska, Hawaii, Northern Marianas) plus current notices and
 * historic eruption metadata. Pairs nicely with `nws.get_alerts` for
 * ash-cloud warnings.
 *
 * API: https://volcanoes.usgs.gov/hans-public/api/
 * Tools:
 * - list_volcanoes:    every US volcano with current alert + color codes
 * - list_elevated:     volcanoes currently above "Normal/Green" status
 * - list_notices:      recent volcano alert notices (VAN / VONA)
 */


const BASE_URL = 'https://volcanoes.usgs.gov/hans-public/api';

const tools: McpToolExport['tools'] = [
  {
    name: 'list_volcanoes',
    description:
      'List every US volcano monitored by USGS with current alert level (Normal/Advisory/Watch/Warning) and aviation color code (Green/Yellow/Orange/Red). Filter optionally by observatory.',
    inputSchema: {
      type: 'object',
      properties: {
        observatory: {
          type: 'string',
          description: 'Observatory short code (AVO=Alaska, CVO=Cascades, YVO=Yellowstone, HVO=Hawaiian, CalVO=California). Optional.',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_elevated',
    description:
      'List only the volcanoes currently above Normal/Green status (i.e., elevated unrest or eruption). Smallest practical fingerprint of "what\'s happening right now."',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_notices',
    description:
      'Recent USGS volcano notices and reports — observatory updates, VAN (Volcano Activity Notice) and VONA (Volcano Observatory Notice for Aviation) text. Filter by volcano slug.',
    inputSchema: {
      type: 'object',
      properties: {
        volcano_slug: {
          type: 'string',
          description: 'USGS volcano slug (e.g., "kilauea", "shishaldin"). Optional — omit for all recent.',
        },
        limit: { type: 'number', description: 'Cap notices returned (default 50)' },
      },
      required: [],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_volcanoes':
      return listVolcanoes(args.observatory as string | undefined);
    case 'list_elevated':
      return listElevated();
    case 'list_notices':
      return listNotices(args.volcano_slug as string | undefined, (args.limit as number) ?? 50);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function hansFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`USGS HANS error: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

interface VolcanoRecord {
  volcano_name?: string;
  url_name?: string;
  observatory?: string;
  alert_level?: string;
  color_code?: string;
  obs_abbr?: string;
  latitude?: number;
  longitude?: number;
  elevation?: number;
  vnum?: string;
  synonyms?: string;
  alert_url?: string;
  alert_message?: string;
  date_modified?: string;
}

function normalizeVolcano(v: VolcanoRecord) {
  return {
    name: v.volcano_name ?? null,
    slug: v.url_name ?? null,
    observatory: v.observatory ?? v.obs_abbr ?? null,
    alert_level: v.alert_level ?? null,
    color_code: v.color_code ?? null,
    latitude: v.latitude ?? null,
    longitude: v.longitude ?? null,
    elevation_m: v.elevation ?? null,
    vnum: v.vnum ?? null,
    synonyms: v.synonyms ?? null,
    alert_message: v.alert_message ?? null,
    alert_url: v.alert_url ?? null,
    modified: v.date_modified ?? null,
  };
}

async function listVolcanoes(observatory: string | undefined) {
  const data = await hansFetch<VolcanoRecord[]>('/volcano/getAllVolcanoes');
  const all = (data ?? []).map(normalizeVolcano);
  const filtered = observatory
    ? all.filter(
        (v) => v.observatory?.toLowerCase() === observatory.toLowerCase(),
      )
    : all;
  return {
    total: all.length,
    returned: filtered.length,
    volcanoes: filtered,
  };
}

async function listElevated() {
  const data = await hansFetch<VolcanoRecord[]>('/elevated/getElevatedVolcanoes');
  const list = (data ?? []).map(normalizeVolcano);
  return {
    count: list.length,
    note: 'All volcanoes currently above Normal/Green status (advisories, watches, or warnings).',
    volcanoes: list,
  };
}

interface NoticeRecord {
  notice_id?: string;
  volcano_name?: string;
  url_name?: string;
  observatory?: string;
  message_type?: string;
  alert_level?: string;
  color_code?: string;
  sent_utc?: string;
  date_modified?: string;
  url?: string;
  summary?: string;
  full_message?: string;
}

function normalizeNotice(n: NoticeRecord) {
  return {
    id: n.notice_id ?? null,
    volcano: n.volcano_name ?? null,
    slug: n.url_name ?? null,
    observatory: n.observatory ?? null,
    type: n.message_type ?? null,
    alert_level: n.alert_level ?? null,
    color_code: n.color_code ?? null,
    sent_utc: n.sent_utc ?? n.date_modified ?? null,
    summary: n.summary ?? null,
    message: n.full_message ?? null,
    url: n.url ?? null,
  };
}

async function listNotices(volcanoSlug: string | undefined, limit: number) {
  // The HANS notices endpoint accepts the slug directly when filtering one volcano.
  const path = volcanoSlug
    ? `/notice/getVolcanoNotices?volcano=${encodeURIComponent(volcanoSlug)}`
    : '/notice/getNotices';
  const data = await hansFetch<NoticeRecord[]>(path);
  const list = (data ?? []).slice(0, Math.max(1, limit)).map(normalizeNotice);
  return {
    volcano_slug: volcanoSlug ?? null,
    count: list.length,
    notices: list,
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
