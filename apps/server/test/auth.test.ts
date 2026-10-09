import { expect, it } from 'vitest';
import { Database } from '../src/database';
import { Auth } from '../src/auth';
it('persists hashed credentials and rejects bad passwords, forged and expired tokens', async () => {
 const db = new Database(':memory:'); let now = 1000; const auth = new Auth(db, 'x'.repeat(32), () => now);
 try { const session = await auth.login('alice', 'correct-password', true); expect(auth.verify(session.token).id).toBe(session.user.id); expect(db.findUser('alice')!.passwordHash).not.toContain('correct-password'); await expect(auth.login('alice', 'wrong-password')).rejects.toThrow('INVALID_CREDENTIALS'); await expect(auth.login('alice', 'correct-password', true)).rejects.toThrow('NAME_TAKEN'); expect(() => auth.verify(session.token + 'x')).toThrow('UNAUTHORIZED'); now += 24 * 3600000; expect(() => auth.verify(session.token)).toThrow('UNAUTHORIZED'); } finally { db.close(); }
});
