import { createHmac, randomUUID } from 'node:crypto';
import { RELAY_BUDGET_BPS, requiredBandwidth } from '../../../packages/shared/src';
import { DomainError } from './engine';
type Lease = { id: string; key: string; roomId: string; sourceEpoch: number; userId: string; peerId: string; reservedBps: number; expiresAt: number };
export class Capacity {
  private leases = new Map<string, Lease>();
  constructor(private now: () => number = Date.now, readonly budget = RELAY_BUDGET_BPS) {}
  private expire() { for (const [id, l] of this.leases) if (l.expiresAt <= this.now()) this.leases.delete(id); }
  get usedBps() { this.expire(); return [...this.leases.values()].reduce((sum, l) => sum + l.reservedBps, 0); }
  reserve(roomId: string, sourceEpoch: number, userId: string, bitrateBps: number, peerId = userId) {
    this.expire(); const key = `${roomId}:${sourceEpoch}:${userId}:${peerId}`;
    const existing = [...this.leases.values()].find(l => l.key === key);
    if (existing) return existing;
    const reservedBps = requiredBandwidth(bitrateBps, 1);
    if (this.usedBps + reservedBps > this.budget) throw new DomainError('RELAY_BUDGET_EXHAUSTED');
    // Credentials live 60s. Reserve an extra 35s for teardown; host traffic shaping is authoritative.
    const lease = { id: randomUUID(), key, roomId, sourceEpoch, userId, peerId, reservedBps, expiresAt: this.now() + 95000 };
    this.leases.set(lease.id, lease); return lease;
  }
  credentials(lease: Lease, host: string, secret: string) {
    const username = `${Math.floor(this.now() / 1000) + 60}:${lease.id}`;
    const password = createHmac('sha1', secret).update(username).digest('base64');
    return [`turn:${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:3478?transport=udp`, `turn:${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:3478?transport=tcp`];
  }
  // Disconnects do not immediately free reservations: existing TURN allocations can outlive signaling.
  renew(id: string, userId: string, roomId: string, epoch: number, peerId = userId) {
    this.expire(); const l = this.leases.get(id);
    if (!l || l.userId !== userId || l.roomId !== roomId || l.sourceEpoch !== epoch || l.peerId !== peerId) throw new DomainError('LEASE_EXPIRED');
    l.expiresAt = this.now() + 95000; return l;
  }
}
