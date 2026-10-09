import { randomUUID } from 'node:crypto';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, MAX_MEMBERS, type Action, type AudioSpec, type Command, type Member, type Permissions, type Playback, type RoomSnapshot, type Track, positionAt, supportsLossless } from '../../../packages/shared/src';

export class DomainError extends Error { constructor(public code: string) { super(code); } }
const fail = (code: string): never => { throw new DomainError(code); };
export type RoomRecord = { id: string; name: string; hostId: string; defaults: Permissions; overrides: Record<string, Partial<Permissions>> };
type InternalRoom = RoomSnapshot & { offlineAt: Map<string, number>; dedup: Map<string, { fingerprint: string; version: number }>; lastIndex: number };
const stopped = (epoch = 0, now = 0): Playback => ({ sourceId: null, sourceEpoch: epoch, sourceType: null, playState: 'stopped', positionMs: 0, effectiveAtServerMs: now, providerId: null, qualityMode: 'lossless', spec: null, bitrateBps: 0, instant: false });

export class RoomEngine {
  readonly rooms = new Map<string, InternalRoom>();
  private preparedEpochs = new Map<string, number>();
  constructor(private persist: (record: RoomRecord) => void = () => {}, private publish: (room: RoomSnapshot) => void = () => {}, private now: () => number = Date.now) {}
  restore(records: RoomRecord[]) { for (const record of records) this.rooms.set(record.id, this.make(record)); }
  private make(record: RoomRecord): InternalRoom {
    return { ...record, stateVersion: 0, members: [], playlist: [], playback: stopped(), pending: null, requests: [], serverNow: this.now(), offlineAt: new Map([[record.hostId, this.now()]]), dedup: new Map(), lastIndex: -1 };
  }
  create(name: string, hostId: string): RoomSnapshot {
    const id = randomUUID();
    const room = this.make({ id, name, hostId, defaults: { ...DEFAULT_PERMISSIONS }, overrides: {} });
    this.rooms.set(id, room); this.save(room); return this.snapshot(id);
  }
  private get(id: string): InternalRoom { return this.rooms.get(id) ?? fail('ROOM_NOT_FOUND'); }
  snapshot(id: string): RoomSnapshot {
    const r = this.get(id);
    return structuredClone({ id: r.id, name: r.name, hostId: r.hostId, stateVersion: r.stateVersion, defaults: r.defaults, members: r.members, playlist: r.playlist, playback: r.playback, pending: r.pending, requests: r.requests, serverNow: this.now() });
  }
  list() { return [...this.rooms.values()].map(r => ({ id: r.id, name: r.name, members: r.members.filter(m => m.online).length, maxMembers: MAX_MEMBERS, qualityMode: r.playback.qualityMode })); }
  private overrides = new Map<string, Record<string, Partial<Permissions>>>();
  restoreOverrides(records: RoomRecord[]) { for (const r of records) this.overrides.set(r.id, r.overrides); }
  private save(r: InternalRoom) { this.persist({ id: r.id, name: r.name, hostId: r.hostId, defaults: r.defaults, overrides: this.overrides.get(r.id) ?? {} }); }
  private refreshPermissions(r: InternalRoom) {
    for (const m of r.members) { m.overrides = this.overrides.get(r.id)?.[m.id] ?? {}; m.permissions = m.id === r.hostId ? { ...ALL_PERMISSIONS } : { ...r.defaults, ...m.overrides }; }
  }
  private changed(r: InternalRoom, durable = false) { r.stateVersion++; this.refreshPermissions(r); if (durable) this.save(r); this.publish(this.snapshot(r.id)); }
  join(id: string, user: { id: string; name: string }) {
    const r = this.get(id); let member = r.members.find(m => m.id === user.id);
    if (member?.online) return this.snapshot(id);
    if (r.members.filter(m => m.online).length >= MAX_MEMBERS) fail('ROOM_FULL');
    if (!member) { member = { ...user, joinedAt: this.now(), online: true, overrides: {}, permissions: { ...r.defaults } }; r.members.push(member); }
    else { member.online = true; member.name = user.name; }
    r.offlineAt.delete(user.id);
    for (const t of r.playlist) if (t.providerId === user.id) t.available = true;
    this.changed(r); return this.snapshot(id);
  }
  leave(id: string, userId: string) {
    const r = this.get(id); const m = r.members.find(m => m.id === userId); if (!m?.online) return;
    m.online = false; r.offlineAt.set(userId, this.now());
    for (const t of r.playlist) if (t.providerId === userId) t.available = false;
    r.requests = r.requests.filter(q => q.memberId !== userId);
    if (r.pending?.playback.providerId === userId) r.pending = null;
    // File playback continues only while recipients have verified buffered data.
    // Receivers report exhaustion; live playback cannot continue without its provider.
    if (r.playback.providerId === userId && r.playback.sourceType === 'live') { r.playback = stopped(r.playback.sourceEpoch + 1, this.now()); this.advance(r); }
    this.changed(r);
  }
  private member(r: InternalRoom, userId: string): Member { return r.members.find(m => m.id === userId && m.online) ?? fail('NOT_IN_ROOM'); }
  private require(r: InternalRoom, userId: string, permission: keyof Permissions) { if (!this.member(r, userId).permissions[permission]) fail('FORBIDDEN'); }
  private host(r: InternalRoom, userId: string) { this.member(r, userId); if (r.hostId !== userId) fail('HOST_ONLY'); }
  private validateSpec(spec: AudioSpec, lossless = true) { if (lossless && !supportsLossless(spec)) fail('UNSUPPORTED_AUDIO_SPEC'); }
  private filePlayback(r: InternalRoom, t: Track, instant = false): Playback {
    if (!t.available) fail('PROVIDER_OFFLINE');
    return { sourceId: t.id, sourceEpoch: Math.max(r.playback.sourceEpoch, r.pending?.playback.sourceEpoch ?? 0) + 1, sourceType: 'file', playState: 'playing', positionMs: 0, effectiveAtServerMs: this.now() + 3000, providerId: t.providerId, qualityMode: t.lossless ? 'lossless' : 'source', spec: t.spec, bitrateBps: t.bitrateBps, instant };
  }
  private livePlayback(r: InternalRoom, providerId: string, spec: AudioSpec, bitrateBps: number): Playback {
    this.validateSpec(spec);
    return { sourceId: randomUUID(), sourceEpoch: Math.max(r.playback.sourceEpoch, r.pending?.playback.sourceEpoch ?? 0) + 1, sourceType: 'live', playState: 'playing', positionMs: 0, effectiveAtServerMs: this.now() + 3000, providerId, qualityMode: 'lossless', spec, bitrateBps, instant: true };
  }
  private prepare(r: InternalRoom, playback: Playback, followTimeline = false) {
    const now = this.now();
    playback.sourceEpoch = Math.max(this.preparedEpochs.get(r.id) ?? 0, r.playback.sourceEpoch, r.pending?.playback.sourceEpoch ?? 0) + 1;
    this.preparedEpochs.set(r.id, playback.sourceEpoch);
    r.pending = { id: randomUUID(), playback, previous: { ...r.playback }, ready: [], preparedAt: now, deadlineAt: now + 5000, committed: false, followTimeline };
  }
  private advance(r: InternalRoom, delta = 1, wrap = true) {
    const current = r.playlist.findIndex(t => t.id === r.playback.sourceId);
    const start = current >= 0 ? current : r.lastIndex;
    for (let i = 1; i <= r.playlist.length; i++) {
      if (!wrap && start + delta * i >= r.playlist.length) break;
      const index = ((start + delta * i) % r.playlist.length + r.playlist.length) % r.playlist.length;
      const t = r.playlist[index];
      if (t.available) { r.lastIndex = index; this.prepare(r, this.filePlayback(r, t)); return; }
    }
    r.pending = null; r.playback = stopped(r.playback.sourceEpoch + 1, this.now());
  }
  command(userId: string, command: Command) {
    const r = this.get(command.roomId); this.member(r, userId);
    const key = `${userId}:${command.commandId}`, fingerprint = JSON.stringify(command);
    const prior = r.dedup.get(key);
    if (prior) { if (prior.fingerprint !== fingerprint) fail('COMMAND_ID_REUSED'); return prior.version; }
    if (command.expectedStateVersion !== r.stateVersion) fail('STATE_CONFLICT');
    const a = command.action;
    if (r.pending && ['play', 'instant', 'next', 'previous', 'pause', 'resume', 'seek', 'startLive', 'approveLive', 'quality'].includes(a.type)) fail('PLAYBACK_TRANSITION_PENDING');
    this.apply(r, userId, a);
    this.changed(r, a.type === 'permission' || a.type === 'defaults');
    r.dedup.set(key, { fingerprint, version: r.stateVersion });
    if (r.dedup.size > 2048) r.dedup.delete(r.dedup.keys().next().value!);
    return r.stateVersion;
  }
  private apply(r: InternalRoom, userId: string, a: Action) {
    switch (a.type) {
      case 'enqueue': {
        this.require(r, userId, 'enqueue'); this.validateSpec(a.payload.spec, a.payload.lossless);
        if (r.playlist.length >= 200) fail('PLAYLIST_FULL');
        if (r.playlist.some(t => t.id === a.payload.id)) fail('DUPLICATE_TRACK');
        r.playlist.push({ ...a.payload, providerId: userId, available: true }); break;
      }
      case 'remove': {
        const t = r.playlist.find(t => t.id === a.payload.trackId) ?? fail('TRACK_NOT_FOUND');
        if (r.hostId !== userId && (t.providerId !== userId || r.playback.sourceId === t.id || r.pending?.playback.sourceId === t.id)) fail('HOST_ONLY');
        if (r.playback.sourceId === t.id || r.pending?.playback.sourceId === t.id) fail('TRACK_IN_USE');
        r.playlist = r.playlist.filter(item => item.id !== a.payload.trackId); break;
      }
      case 'reorder': {
        this.host(r, userId); const ids = a.payload.trackIds;
        if (ids.length !== r.playlist.length || new Set(ids).size !== ids.length || ids.some(id => !r.playlist.some(t => t.id === id))) fail('INVALID_TRACK_ORDER');
        r.playlist = ids.map(id => r.playlist.find(t => t.id === id)!); break;
      }
      case 'clear': this.host(r, userId); if (r.playback.sourceType === 'file' || r.pending) fail('TRACK_IN_USE'); r.playlist = []; break;
      case 'play': {
        this.require(r, userId, 'skip'); const t = r.playlist.find(t => t.id === a.payload.trackId) ?? fail('TRACK_NOT_FOUND');
        r.lastIndex = r.playlist.indexOf(t); this.prepare(r, this.filePlayback(r, t)); break;
      }
      case 'instant': {
        if (r.playlist.length >= 200) fail('PLAYLIST_FULL');
        this.require(r, userId, 'skip'); this.require(r, userId, 'stream'); this.validateSpec(a.payload.spec, a.payload.lossless);
        if (r.playlist.some(t => t.id === a.payload.id)) fail('DUPLICATE_TRACK');
        const t = { ...a.payload, providerId: userId, available: true }; r.playlist.push(t); this.prepare(r, this.filePlayback(r, t, true)); break;
      }
      case 'next': case 'previous': this.require(r, userId, 'skip'); this.advance(r, a.type === 'next' ? 1 : -1); break;
      case 'stop': this.require(r, userId, 'skip'); if (r.playback.sourceType === 'live') { r.pending = null; r.playback = stopped(r.playback.sourceEpoch + 1, this.now()); this.advance(r); } else { r.pending = null; r.playback = stopped(r.playback.sourceEpoch + 1, this.now()); } break;
      case 'stopLive': {
        const epoch = a.payload.sourceEpoch;
        const source = r.pending?.playback.sourceEpoch === epoch ? r.pending.playback : r.playback;
        if (source.sourceEpoch !== epoch) fail('STALE_SOURCE');
        if (source.sourceType !== 'live') fail('LIVE_ONLY');
        if (userId !== r.hostId && userId !== source.providerId) fail('FORBIDDEN');
        const pending = r.pending;
        if (pending?.playback.sourceEpoch === epoch && (r.playback.sourceType !== 'live' || r.playback.providerId !== source.providerId)) {
          r.pending = null; // Cancel preparation, retaining the previous room source.
        } else {
          if (pending?.playback.providerId === source.providerId) r.pending = null;
          r.playback = stopped(Math.max(epoch, r.playback.sourceEpoch) + 1, this.now());
          if (!r.pending) this.advance(r);
        }
        break;
      }
      case 'pause': case 'resume': case 'seek': {
        this.require(r, userId, a.type === 'seek' ? 'seek' : 'skip');
        if (r.playback.sourceType !== 'file') fail('FILE_ONLY');
        if (a.type === 'pause' && r.playback.playState !== 'playing' || a.type === 'resume' && r.playback.playState !== 'paused') fail('INVALID_PLAY_STATE');
        const t = r.playlist.find(t => t.id === r.playback.sourceId) ?? fail('TRACK_NOT_FOUND');
        const position = a.type === 'seek' ? a.payload.positionMs : positionAt(r.playback, this.now() + 3000);
        if (position >= t.durationMs) fail('SEEK_OUT_OF_RANGE');
        this.prepare(r, { ...r.playback, sourceEpoch: r.playback.sourceEpoch + 1, positionMs: position, playState: a.type === 'pause' ? 'paused' : a.type === 'resume' ? 'playing' : r.playback.playState, effectiveAtServerMs: this.now() + 3000 }, a.type !== 'seek'); break;
      }
      case 'startLive': this.require(r, userId, 'stream'); this.require(r, userId, 'skip'); this.prepare(r, this.livePlayback(r, userId, a.payload.spec, a.payload.bitrateBps)); break;
      case 'requestLive': this.require(r, userId, 'stream'); this.validateSpec(a.payload.spec); if (r.requests.some(q => q.memberId === userId)) fail('REQUEST_EXISTS'); r.requests.push({ id: randomUUID(), memberId: userId, ...a.payload }); break;
      case 'approveLive': {
        this.host(r, userId); const q = r.requests.find(q => q.id === a.payload.requestId) ?? fail('REQUEST_NOT_FOUND');
        this.require(r, q.memberId, 'stream'); this.prepare(r, this.livePlayback(r, q.memberId, q.spec, q.bitrateBps)); r.requests = r.requests.filter(v => v.id !== q.id); break;
      }
      case 'rejectLive': this.host(r, userId); r.requests = r.requests.filter(q => q.id !== a.payload.requestId); break;
      case 'quality': {
        if (r.hostId !== userId && r.playback.providerId !== userId) fail('FORBIDDEN');
        if (!r.playback.sourceId) fail('NO_SOURCE');
        const t = r.playlist.find(t => t.id === r.playback.sourceId);
        if (a.payload.qualityMode === 'lossless' && r.playback.sourceType === 'file' && !t?.lossless) fail('SOURCE_IS_LOSSY');
        if (a.payload.qualityMode === 'source' && r.playback.sourceType === 'live') fail('INVALID_QUALITY');
        this.prepare(r, { ...r.playback, sourceEpoch: r.playback.sourceEpoch + 1, qualityMode: a.payload.qualityMode, positionMs: positionAt(r.playback, this.now() + 3000), effectiveAtServerMs: this.now() + 3000, bitrateBps: a.payload.qualityMode === 'opus' ? 230400 : t?.bitrateBps ?? (r.playback.spec!.sampleRate * r.playback.spec!.bits * r.playback.spec!.channels) }, true); break;
      }
      case 'defaults': this.host(r, userId); r.defaults = { ...a.payload }; this.refreshPermissions(r); this.revoke(r); break;
      case 'permission': {
        this.host(r, userId); if (!r.members.some(m => m.id === a.payload.memberId)) fail('MEMBER_NOT_FOUND');
        const overrides = this.overrides.get(r.id) ?? {}; overrides[a.payload.memberId] = { ...a.payload.overrides }; this.overrides.set(r.id, overrides); this.refreshPermissions(r); this.revoke(r); break;
      }
    }
  }
  private revoke(r: InternalRoom) {
    r.requests = r.requests.filter(q => r.members.find(m => m.id === q.memberId)?.permissions.stream);
    if (r.pending?.playback.instant && !r.members.find(m => m.id === r.pending!.playback.providerId)?.permissions.stream) r.pending = null;
    if (r.playback.instant && !r.members.find(m => m.id === r.playback.providerId)?.permissions.stream) {
      if (r.playback.sourceType === 'file') r.playlist = r.playlist.filter(t => t.id !== r.playback.sourceId);
      r.pending = null; r.playback = stopped(r.playback.sourceEpoch + 1, this.now()); this.advance(r);
    }
  }
  ready(roomId: string, userId: string, transitionId: string, epoch: number) {
    const r = this.get(roomId); this.member(r, userId); const p = r.pending;
    if (!p || p.id !== transitionId || p.playback.sourceEpoch !== epoch || p.committed) return;
    if (!p.ready.includes(userId)) p.ready.push(userId);
    this.publish(this.snapshot(roomId));
  }
  exhausted(roomId: string, userId: string, epoch: number) {
    const r = this.get(roomId); this.member(r, userId);
    if (epoch !== r.playback.sourceEpoch || r.pending || r.playback.sourceType !== 'file') return;
    if (r.members.find(m => m.id === r.playback.providerId)?.online) return;
    this.advance(r); this.changed(r);
  }
  sourceFailed(roomId: string, userId: string, epoch: number) {
    const r = this.get(roomId); this.member(r, userId);
    if (r.pending?.playback.providerId === userId && r.pending.playback.sourceEpoch === epoch) { r.pending = null; this.changed(r); }
    else if (r.playback.providerId === userId && r.playback.sourceEpoch === epoch) { const t = r.playlist.find(t => t.id === r.playback.sourceId); if (t) t.available = false; r.playback = stopped(r.playback.sourceEpoch + 1, this.now()); this.advance(r); this.changed(r); }
  }
  tick() {
    for (const r of this.rooms.values()) {
      const now = this.now(); let changed = false, durable = false;
      const p = r.pending;
      if (p && !p.committed && (r.members.filter(m => m.online).every(m => p.ready.includes(m.id)) || now >= p.deadlineAt)) {
        p.committed = true; p.playback.effectiveAtServerMs = Math.max(p.playback.effectiveAtServerMs, now + 200); if (p.followTimeline) p.playback.positionMs = positionAt(p.previous, p.playback.effectiveAtServerMs); changed = true;
      }
      if (p?.committed && now >= p.playback.effectiveAtServerMs) { r.playback = p.playback; r.pending = null; changed = true; }
      if (!r.pending && r.playback.sourceType === 'file' && r.playback.playState === 'playing') {
        const t = r.playlist.find(t => t.id === r.playback.sourceId);
        if (t && positionAt(r.playback, now) >= t.durationMs) { this.advance(r, 1, false); changed = true; }
      }
      const host = r.members.find(m => m.id === r.hostId);
      const offlineAt = r.offlineAt.get(r.hostId);
      if (!host?.online && ((offlineAt !== undefined && now - offlineAt >= 60000) || (offlineAt === undefined && r.members.some(m => m.online)))) {
        const next = r.members.filter(m => m.online).sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (next) { r.hostId = next.id; changed = true; durable = true; }
      }
      for (const [id, at] of r.offlineAt) if (id !== r.hostId && now - at >= 60000) { r.members = r.members.filter(m => m.id !== id); r.offlineAt.delete(id); changed = true; }
      if (changed) this.changed(r, durable);
    }
  }
}
