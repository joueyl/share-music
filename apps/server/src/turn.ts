import { z } from 'zod';
import { DomainError } from './engine';

const entriesSchema = z.array(z.object({ urls: z.union([z.string(), z.array(z.string()).min(1)]), username: z.string().optional(), credential: z.string().optional() })).min(1).max(32);
export function nativeIceServers(value: unknown): string[] {
  const result: string[] = [];
  for (const entry of entriesSchema.parse(value)) {
    for (const uri of typeof entry.urls === 'string' ? [entry.urls] : entry.urls) {
      const match = /^(stun|stuns|turn|turns):([a-z0-9.-]+|\[[a-f0-9:]+\])(?::([0-9]+))?(\?transport=(?:udp|tcp))?$/i.exec(uri);
      if (!match || match[3] && (+match[3] < 1 || +match[3] > 65535)) throw new DomainError('TURN_INVALID_RESPONSE');
      if (match[1].startsWith('turn')) {
        if (!entry.username || !entry.credential) throw new DomainError('TURN_INVALID_RESPONSE');
        result.push(`${match[1]}:${encodeURIComponent(entry.username)}:${encodeURIComponent(entry.credential)}@${uri.slice(match[1].length + 1)}`);
      } else result.push(uri);
    }
  }
  if (!result.some(u => u.startsWith('turn:') || u.startsWith('turns:'))) throw new DomainError('TURN_INVALID_RESPONSE');
  return [...new Set(result)].slice(0, 7);
}
export class PublicTurn {
  readonly provider: string;
  readonly budget: number;
  private cached?: { servers: string[]; expires: number };
  private pending?: Promise<string[]>;
  constructor(private env: NodeJS.ProcessEnv = process.env, private request: typeof fetch = fetch, private now = Date.now) {
    this.provider = env.TURN_PROVIDER ?? 'coturn';
    if (!['coturn', 'metered', 'static'].includes(this.provider)) throw new Error('Invalid TURN_PROVIDER');
    this.budget = Number(env.PUBLIC_TURN_BUDGET_BPS ?? 3500000);
    if (!Number.isSafeInteger(this.budget) || this.budget < 1 || this.budget > 1000000000) throw new Error('Invalid PUBLIC_TURN_BUDGET_BPS');
  }
  get external() { return this.provider !== 'coturn'; }
  stun(): string[] {
    const configured = this.env.STUN_URLS ?? this.env.STUN_URL;
    const servers = [...new Set((configured ?? 'stun:stun.miwifi.com:3478,stun:39.107.142.158:3478').split(',').map(s => s.trim()).filter(Boolean))];
    if (!servers.length || servers.length > 4 || servers.some(uri => {
      const match = /^stuns?:([a-z0-9.-]+|\[[a-f0-9:]+\])(?::([0-9]+))?$/i.exec(uri);
      return !match || match[2] && (+match[2] < 1 || +match[2] > 65535);
    })) throw new DomainError('INVALID_STUN_CONFIG');
    return servers;
  }
  iceServers(relay: string[] = []): string[] {
    const turn = relay.filter(uri => /^turns?:/i.test(uri));
    // Keep native libdatachannel's limit of eight, reserving room for configured STUN.
    const stun = this.stun();
    return [...stun, ...turn.slice(0, 8 - stun.length)];
  }
  async credentials(): Promise<string[]> {
    if (this.provider === 'static') {
      const urls = this.env.TURN_URLS?.split(',').map(s => s.trim()).filter(Boolean);
      if (!urls?.length || !this.env.TURN_USERNAME || !this.env.TURN_PASSWORD) throw new DomainError('TURN_NOT_CONFIGURED');
      return nativeIceServers([{ urls, username: this.env.TURN_USERNAME, credential: this.env.TURN_PASSWORD }]);
    }
    if (this.provider !== 'metered') throw new DomainError('TURN_NOT_CONFIGURED');
    const domain = this.env.METERED_DOMAIN, key = this.env.METERED_API_KEY;
    if (!domain || !/^[a-z0-9-]+\.metered\.live$/i.test(domain) || !key) throw new DomainError('TURN_NOT_CONFIGURED');
    if (this.cached && this.cached.expires > this.now()) return this.cached.servers;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const url = new URL(`https://${domain}/api/v1/turn/credentials`); url.searchParams.set('apiKey', key);
        const response = await this.request(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
        if (!response.ok) throw new DomainError('TURN_PROVIDER_UNAVAILABLE');
        const text = await response.text();
        if (text.length > 32768) throw new DomainError('TURN_INVALID_RESPONSE');
        const servers = nativeIceServers(JSON.parse(text));
        this.cached = { servers, expires: this.now() + 30000 };
        return servers;
      } catch (error) {
        // Never return provider request URLs, API keys or response bodies to clients/logs.
        throw error instanceof DomainError ? error : new DomainError('TURN_PROVIDER_UNAVAILABLE');
      } finally { this.pending = undefined; }
    })();
    return this.pending;
  }
}
