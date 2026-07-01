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
  // list_elevated re-pointed to the renamed getCAPElevated action (2026-06-11).
  if (name === 'list_elevated') return await listElevated();

  // Re-pointed 2026-07: USGS HANS renamed getAllVolcanoes -> getMonitoredVolcanoes
  // (each record carries the volcano's latest notice) and dropped the standalone
  // notices action, so both tools are served from that one endpoint now.
  if (name === 'list_volcanoes') return await listVolcanoes(args.observatory as string | undefined);
  if (name === 'list_notices') return await listNotices(args.volcano_slug as string | undefined, (args.limit as number) ?? 20);
  throw new Error(`Unknown tool: ${name}`);
}

async function hansFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`USGS HANS error: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// getMonitoredVolcanoes returns one record per monitored volcano, each carrying
// its latest alert + notice.
interface MonitoredRecord {
  volcano_name?: string;
  vnum?: string;
  volcano_cd?: string;
  obs_abbr?: string;
  obs_fullname?: string;
  alert_level?: string;
  color_code?: string;
  sent_utc?: string;
  sent_unixtime?: number;
  notice_type_cd?: string;
  notice_identifier?: string;
  notice_url?: string;
  notice_data?: string;
}

function slugify(name?: string): string | null {
  return name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null;
}

function normalizeVolcano(v: MonitoredRecord) {
  return {
    name: v.volcano_name ?? null,
    slug: slugify(v.volcano_name),
    observatory: v.obs_abbr ?? null,
    observatory_full: v.obs_fullname ?? null,
    alert_level: v.alert_level ?? null,
    color_code: v.color_code ?? null,
    vnum: v.vnum ?? null,
    latest_notice_type: v.notice_type_cd ?? null,
    latest_notice_url: v.notice_url ?? null,
    updated_utc: v.sent_utc ?? null,
  };
}

async function listVolcanoes(observatory: string | undefined) {
  const data = await hansFetch<MonitoredRecord[]>('/volcano/getMonitoredVolcanoes');
  const all = (data ?? []).map(normalizeVolcano);
  const filtered = observatory
    ? all.filter((v) => v.observatory?.toLowerCase() === observatory.toLowerCase())
    : all;
  return { total: all.length, returned: filtered.length, volcanoes: filtered };
}

// USGS HANS renamed elevated/getElevatedVolcanoes → volcano/getCAPElevated
// (CAP = Common Alerting Protocol) with new field names. Re-pointed 2026-06-11.
interface CapElevatedRecord {
  volcano_name_appended?: string;
  latitude?: number;
  longitude?: number;
  vnum?: string;
  elevation_meters?: number;
  obs_fullname?: string;
  alert_level?: string;
  color_code?: string;
  cap_certainty?: string;
  cap_severity?: string;
  cap_urgency?: string;
  notice_identifier?: string;
  sent_date_cap?: string;
}

async function listElevated() {
  const data = await hansFetch<CapElevatedRecord[]>('/volcano/getCAPElevated');
  const list = (data ?? []).map((v) => ({
    volcano_name: v.volcano_name_appended ?? null,
    alert_level: v.alert_level ?? null,
    color_code: v.color_code ?? null,
    observatory: v.obs_fullname ?? null,
    latitude: v.latitude ?? null,
    longitude: v.longitude ?? null,
    elevation_m: v.elevation_meters ?? null,
    vnum: v.vnum ?? null,
    cap_certainty: v.cap_certainty ?? null,
    cap_severity: v.cap_severity ?? null,
    cap_urgency: v.cap_urgency ?? null,
    notice_id: v.notice_identifier ?? null,
    sent_at: v.sent_date_cap ?? null,
  }));
  return {
    count: list.length,
    note: 'Volcanoes currently above Normal/Green status (advisory / watch / warning), with CAP alert details. Source: USGS HANS getCAPElevated.',
    volcanoes: list,
  };
}

function normalizeNotice(n: MonitoredRecord) {
  return {
    volcano: n.volcano_name ?? null,
    slug: slugify(n.volcano_name),
    observatory: n.obs_abbr ?? null,
    type: n.notice_type_cd ?? null,
    notice_id: n.notice_identifier ?? null,
    alert_level: n.alert_level ?? null,
    color_code: n.color_code ?? null,
    sent_utc: n.sent_utc ?? null,
    url: n.notice_url ?? null,
    message: n.notice_data ?? null,
  };
}

async function listNotices(volcanoSlug: string | undefined, limit: number) {
  // No standalone notices action survives the HANS rename; each monitored
  // volcano carries its latest notice, so derive the list from
  // getMonitoredVolcanoes (sorted newest-first, optionally filtered by volcano).
  const data = await hansFetch<MonitoredRecord[]>('/volcano/getMonitoredVolcanoes');
  let list = (data ?? []).filter((n) => n.notice_identifier || n.notice_url);
  if (volcanoSlug) {
    const s = volcanoSlug.toLowerCase();
    list = list.filter((n) => slugify(n.volcano_name)?.includes(s) || n.volcano_cd?.toLowerCase() === s);
  }
  list.sort((a, b) => (b.sent_unixtime ?? 0) - (a.sent_unixtime ?? 0));
  const notices = list.slice(0, Math.max(1, limit)).map(normalizeNotice);
  return { volcano_slug: volcanoSlug ?? null, count: notices.length, notices };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
