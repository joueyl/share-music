import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DomainError } from './engine';
import type { DatabaseStore } from './database';
const scrypt = promisify(scryptCallback);
export class Auth {
  constructor(private db: DatabaseStore, private secret: string, private now = Date.now) {
    if (secret.length < 32) throw new Error('TOKEN_SECRET must contain at least 32 characters');
  }
  async login(name: string, password: string, register = false) {
    let user = await this.db.findUser(name);
    if (register) {
      if (user) throw new DomainError('NAME_TAKEN');
      const salt = randomBytes(16).toString('hex');
      const passwordHash = (await scrypt(password, salt, 64) as Buffer).toString('hex');
      user = { id: randomUUID(), name, salt, passwordHash };
      try { await this.db.insertUser(user); } catch(e) { if(e instanceof DomainError && e.code==='DATABASE_UNAVAILABLE')throw e;throw new DomainError('NAME_TAKEN'); }
    } else {
      // Perform the same work for unknown users to reduce account timing disclosure.
      const hash = await scrypt(password, user?.salt ?? 'unknown-user-salt', 64) as Buffer;
      if (!user || !timingSafeEqual(hash, Buffer.from(user.passwordHash, 'hex'))) throw new DomainError('INVALID_CREDENTIALS');
    }
    const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: this.now() + 24 * 3600000 })).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return { token: `${payload}.${signature}`, user: { id: user.id, name: user.name } };
  }
  async verify(token: string) {
    try {
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra) throw new Error();
      const expected = createHmac('sha256', this.secret).update(payload).digest();
      const received = Buffer.from(signature, 'base64url');
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error();
      const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (typeof exp !== 'number' || exp <= this.now() || typeof sub !== 'string') throw new Error();
      const user = await this.db.getUser(sub); if (!user) throw new Error();
      return { id: user.id, name: user.name, expiresAt: exp };
    } catch(e) { if(e instanceof DomainError&&e.code==='DATABASE_UNAVAILABLE')throw e;throw new DomainError('UNAUTHORIZED'); }
  }
}
