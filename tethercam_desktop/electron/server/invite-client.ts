const INVITE_PORT = 4748;
const REQUEST_TIMEOUT_MS = 5000;

export interface InviteResult {
  ok: boolean;
  error?: string;
}

/**
 * Ask a phone on the LAN to connect to this desktop via its invite HTTP server.
 */
export async function invitePhoneViaWifi(phoneIp: string, connectionUrl: string): Promise<InviteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const inviteUrl =
      `http://${phoneIp}:${INVITE_PORT}/api/invite?url=${encodeURIComponent(connectionUrl)}`;
    const response = await fetch(inviteUrl, { signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { ok: false, error: body || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe whether a phone invite server is reachable (app open on LAN).
 */
export async function probePhone(phoneIp: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`http://${phoneIp}:${INVITE_PORT}/api/info`, {
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { role?: string };
    return data.role === 'mobile';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
