export const AI_SERVER_CONTROL_URL = 'http://127.0.0.1:8742';

export type AiServerState = 'running' | 'starting' | 'stopped' | 'unknown';

export interface AiServerStatus {
  id: string;
  label?: string;
  title?: string;
  state: AiServerState;
  /** True when this model server was already up before this window started it. */
  adopted?: boolean;
  endpoint?: string;
  container?: string;
  model?: string | null;
  version?: string | null;
  context?: number | null;
  detail?: string | null;
}

export interface AiServerMemory {
  sram_used?: number;
  sram_total?: number;
  host_used?: number;
}

export interface AiServerList {
  servers: AiServerStatus[];
  memory?: AiServerMemory;
}

export const EMPTY_AI_SERVER_LIST: AiServerList = { servers: [] };

function normalizeState(state: string | undefined): AiServerState {
  if (state === 'running' || state === 'starting' || state === 'stopped') {
    return state;
  }
  return 'unknown';
}

export async function fetchAiServer(path: string): Promise<AiServerList> {
  const response = await fetch(`${AI_SERVER_CONTROL_URL}${path}`, {
    method: path === '/status' ? 'GET' : 'POST',
  });
  if (!response.ok) {
    throw new Error(`${response.status}`);
  }
  const body = (await response.json()) as AiServerList;
  return {
    servers: (body.servers ?? []).map((server) => ({
      ...server,
      state: normalizeState(server.state),
    })),
  };
}

/** One line for the sidebar. A running engine wins over a starting one. */
export function aiServerSummary(list: AiServerList): {
  state: AiServerState;
  label: string;
} {
  const running = list.servers.find((server) => server.state === 'running');
  if (running) {
    return { state: 'running', label: running.label || 'Running' };
  }
  const starting = list.servers.find((server) => server.state === 'starting');
  if (starting) {
    return { state: 'starting', label: starting.label || 'Starting' };
  }
  if (list.servers.some((server) => server.state === 'stopped')) {
    return { state: 'stopped', label: '' };
  }
  return { state: 'unknown', label: '' };
}
