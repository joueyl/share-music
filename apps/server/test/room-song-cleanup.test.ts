import { expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { cleanupRoomSongCopies, ROOM_SONG_COPIES } from '../src/room-song-cleanup';

function fixture() {
  const connection={query:vi.fn().mockResolvedValue([{affectedRows:2},[]]),beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn()};
  const pool={query:vi.fn().mockResolvedValue([[{total:2}],[]]),getConnection:vi.fn().mockResolvedValue(connection)};
  return {connection,pool,db:pool as unknown as Pool};
}
it('defaults to a read-only count and only matches safely redundant room copies',async()=>{
  const {db,pool}=fixture();expect(await cleanupRoomSongCopies(db)).toEqual({mode:'dry-run',candidates:2,removed:0,backupTable:null});
  expect(pool.getConnection).not.toHaveBeenCalled();expect(pool.query).toHaveBeenCalledOnce();
  expect(ROOM_SONG_COPIES).toContain("canonical.scope='netease'");
  for(const check of ['canonical.content_hash=legacy.content_hash','canonical.size_bytes=legacy.size_bytes','canonical.track_json IS NOT NULL','legacy.detail_json IS NULL'])expect(ROOM_SONG_COPIES).toContain(check);
});
it('backs up full rows before deleting exactly those rows in one transaction',async()=>{
  const {db,connection}=fixture();const result=await cleanupRoomSongCopies(db,true);
  expect(result).toMatchObject({mode:'cleanup',removed:2});expect(result.backupTable).toMatch(/^songs_room_backup_[a-f0-9]{32}$/);
  const sql=connection.query.mock.calls.map(c=>c[0]);
  expect(sql[0]).toContain(' LIKE songs');expect(sql[1]).toContain('SELECT legacy.*');
  expect(sql[2]).toContain(`JOIN \`${result.backupTable}\` backup ON legacy.sequence=backup.sequence`);
  expect(connection.beginTransaction).toHaveBeenCalledOnce();expect(connection.commit).toHaveBeenCalledOnce();expect(connection.release).toHaveBeenCalledOnce();
});
it('rolls back on delete failure or a verification mismatch and always releases',async()=>{
  for(const mismatch of [false,true]){
    const {db,connection}=fixture();
    if(mismatch)connection.query.mockResolvedValueOnce([{},[]]).mockResolvedValueOnce([{affectedRows:2},[]]).mockResolvedValueOnce([{affectedRows:1},[]]);
    else connection.query.mockResolvedValueOnce([{},[]]).mockResolvedValueOnce([{affectedRows:2},[]]).mockRejectedValueOnce(Error('delete failed'));
    await expect(cleanupRoomSongCopies(db,true)).rejects.toThrow();
    expect(connection.rollback).toHaveBeenCalledOnce();expect(connection.commit).not.toHaveBeenCalled();expect(connection.release).toHaveBeenCalledOnce();
  }
});
