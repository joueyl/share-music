import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PublicTurn } from '../src/turn';

// Inspect the public template only, never the machine's real .env or credentials.
const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const assignments = Object.fromEntries([...template.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map(m => [m[1], m[2].trim()]));

it('keeps current service configuration and optional TLS/proxy/QQ settings in the public template', () => {
 expect(Object.keys(assignments).sort()).toEqual([
  'NODE_ENV','PORT','BIND_ADDRESS','TRUST_PROXY','DATABASE_DRIVER','DATABASE_URL',
  'TOKEN_SECRET','ALLOWED_ORIGINS','NETEASE_ADMIN_TOKEN','NETEASE_LOGIN_ORIGIN',
  'QQ_MUSIC_API_URL','QQ_MUSIC_STATE_DIR',
 ].sort());
 expect(template).toMatch(/^# MYSQL_SSL_CA=/m);
 expect(assignments.DATABASE_DRIVER).toBe('mysql');
 expect(assignments.TRUST_PROXY).toBe('');
});

it('omits retired client transport settings, including the commented single-STUN alias', () => {
 for (const name of ['STUN_URLS','STUN_URL','TURN_PROVIDER','PUBLIC_TURN_BUDGET_BPS','TURN_SECRET','TURN_PUBLIC_HOST','METERED_DOMAIN','METERED_API_KEY','TURN_URLS','TURN_USERNAME','TURN_PASSWORD']) {
  expect(template).not.toMatch(new RegExp('^\\s*(?:#\\s*)?'+name+'\\s*=', 'm'));
 }
});

it('uses existing validated compatibility defaults without requiring legacy settings for startup', () => {
 const turn = new PublicTurn(assignments);
 expect(turn.provider).toBe('coturn');
 expect(turn.budget).toBe(3500000);
 expect(turn.stun()).toHaveLength(2);
});
