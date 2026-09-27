export const AI_SERVER_CONTROL_URL = 'http://127.0.0.1:8742';

export type AiServerState = 'running' | 'starting' | 'stopped' | 'unknown';

export interface AiServerStatus {
  state: AiServerState;
  /** True when the model server was already up before this window started it. */
  adopted?: boolean;
  endpoint?: string;
  container?: string;
  model?: string | null;
  version?: string | null;
  context?: number | null;
  detail?: string | null;
}

export const EMPTY_AI_SERVER_STATUS: AiServerStatus = { state: 'unknown' };

export async function fetchAiServer(
  path: '/status' | '/start' | '/stop',
): Promise<AiServerStatus> {
  const response = await fetch(`${AI_SERVER_CONTROL_URL}${path}`, {
    method: path === '/status' ? 'GET' : 'POST',
  });
  if (!response.ok) {
    throw new Error(`${response.status}`);
  }
  const body = (await response.json()) as AiServerStatus;
  if (
    body.state !== 'running' &&
    body.state !== 'starting' &&
    body.state !== 'stopped'
  ) {
    return { ...body, state: 'unknown' };
  }
  return body;
}
