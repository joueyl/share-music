import { expect, it, vi } from 'vitest';
import { nativeIceServers, PublicTurn } from '../src/turn';
it('encodes credentials for native TURN UDP/TCP/TLS, without changing the password', () => {
 const result = nativeIceServers([{ urls: ['turn:relay.example.com:80?transport=udp', 'turn:relay.example.com:443?transport=tcp', 'turns:relay.example.com:443?transport=tcp'], username: 'a:b', credential: 'p@ss:word' }]);
 expect(result).toContain('turns:a%3Ab:p%40ss%3Aword@relay.example.com:443?transport=tcp');
 expect(() => nativeIceServers([{ urls: 'https://example.com', username: 'a', credential: 'b' }])).toThrow('TURN_INVALID_RESPONSE');
 expect(() => nativeIceServers([{ urls: 'turn:example.com:99999', username: 'a', credential: 'b' }])).toThrow('TURN_INVALID_RESPONSE');
 expect(() => nativeIceServers([{ urls: 'turn:example.com:80' }])).toThrow('TURN_INVALID_RESPONSE');
});
it('fetches only an allowed Metered hostname, shares concurrent requests and expires the cache', async () => {
 let now = 0;
 const request = vi.fn(async () => new Response(JSON.stringify([{ urls: 'turn:relay.example.com:443?transport=tcp', username: 'u', credential: 'p' }])));
 const turn = new PublicTurn({ TURN_PROVIDER: 'metered', METERED_DOMAIN: 'test.metered.live', METERED_API_KEY: 'private-key' }, request as typeof fetch, () => now);
 await Promise.all([turn.credentials(), turn.credentials()]); expect(request).toHaveBeenCalledTimes(1);
 await turn.credentials(); expect(request).toHaveBeenCalledTimes(1);
 now = 31000; await turn.credentials(); expect(request).toHaveBeenCalledTimes(2);
 const blocked = new PublicTurn({ TURN_PROVIDER: 'metered', METERED_DOMAIN: 'localhost', METERED_API_KEY: 'key' }, request as typeof fetch);
 await expect(blocked.credentials()).rejects.toThrow('TURN_NOT_CONFIGURED'); expect(request).toHaveBeenCalledTimes(2);
});
it('does not leak keys/provider errors and can recover after provider failure', async () => {
 const request = vi.fn().mockRejectedValueOnce(new Error('url?apiKey=secret')).mockResolvedValue(new Response(JSON.stringify([{ urls: 'turn:relay.example.com:443', username: 'u', credential: 'p' }])));
 const turn = new PublicTurn({ TURN_PROVIDER: 'metered', METERED_DOMAIN: 'test.metered.live', METERED_API_KEY: 'secret' }, request);
 await expect(turn.credentials()).rejects.toThrow(/^TURN_PROVIDER_UNAVAILABLE$/); await expect(turn.credentials()).resolves.toHaveLength(1);
});
it('supports static credentials and rejects missing configuration', async () => {
 const turn = new PublicTurn({ TURN_PROVIDER: 'static', TURN_URLS: 'turn:relay.example.com:80,turns:relay.example.com:443?transport=tcp', TURN_USERNAME: 'u', TURN_PASSWORD: 'p', PUBLIC_TURN_BUDGET_BPS: '12000000' });
 expect(turn.external).toBe(true); expect(turn.budget).toBe(12000000); expect(await turn.credentials()).toHaveLength(2);
 await expect(new PublicTurn({ TURN_PROVIDER: 'static' }).credentials()).rejects.toThrow('TURN_NOT_CONFIGURED');
 expect(() => new PublicTurn({ PUBLIC_TURN_BUDGET_BPS: 'NaN' })).toThrow('Invalid PUBLIC_TURN_BUDGET_BPS');
});

it('provides both configured STUN addresses, deduplicates and bounds native ICE lists', () => {
 const turn = new PublicTurn({}); expect(turn.stun()).toEqual(['stun:stun.miwifi.com:3478', 'stun:39.107.142.158:3478']);
 expect(new PublicTurn({ STUN_URLS: 'stun:a.test:3478, stun:a.test:3478,stun:b.test', STUN_URL: 'stun:legacy.test' }).stun()).toEqual(['stun:a.test:3478','stun:b.test']);
 expect(new PublicTurn({ STUN_URL: 'stun:legacy.test:3478' }).stun()).toEqual(['stun:legacy.test:3478']);
 expect(() => new PublicTurn({ STUN_URLS: 'https://invalid.test' }).stun()).toThrow('INVALID_STUN_CONFIG');
 expect(() => new PublicTurn({ STUN_URLS: 'stun:invalid.test:99999' }).stun()).toThrow('INVALID_STUN_CONFIG');
 expect(turn.iceServers(Array.from({length:7},(_,i)=>`turn:u:p@relay${i}.test:3478`))).toHaveLength(8);
});
