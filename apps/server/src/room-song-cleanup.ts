import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// Only remove generated room copies with an existing complete canonical source.
// Unique legacy metadata, different audio versions and song details stay untouched.
export const ROOM_SONG_COPIES = `FROM songs legacy JOIN songs canonical
  ON canonical.scope='netease'
  AND canonical.source=CONCAT('netease:standard:',legacy.netease_id)
  AND canonical.content_hash=legacy.content_hash
  AND canonical.size_bytes=legacy.size_bytes
  AND canonical.track_json IS NOT NULL
  WHERE legacy.scope REGEXP '^room:[0-9a-fA-F-]{36}$'
  AND legacy.source REGEXP '^[0-9a-fA-F-]{36}$'
  AND legacy.detail_json IS NULL
  AND legacy.content_hash IS NOT NULL AND legacy.size_bytes>0`;

/** Run while the application is stopped. Dry-run is read-only by default. */
export async function cleanupRoomSongCopies(pool: Pool, confirm = false) {
  if (!confirm) {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total ${ROOM_SONG_COPIES}`);
    return { mode: 'dry-run', candidates: Number(rows[0].total), removed: 0, backupTable: null };
  }
  const connection = await pool.getConnection();
  const backupTable = `songs_room_backup_${randomUUID().replaceAll('-', '')}`;
  try {
    // DDL is outside the transaction. Keep the full rows for manual recovery.
    await connection.query(`CREATE TABLE \`${backupTable}\` LIKE songs`);
    await connection.beginTransaction();
    try {
      const [saved] = await connection.query<ResultSetHeader>(`INSERT INTO \`${backupTable}\` SELECT legacy.* ${ROOM_SONG_COPIES}`);
      const [deleted] = await connection.query<ResultSetHeader>(`DELETE legacy FROM songs legacy JOIN \`${backupTable}\` backup ON legacy.sequence=backup.sequence`);
      if (saved.affectedRows !== deleted.affectedRows) throw new Error('Cleanup verification failed');
      await connection.commit();
      return { mode: 'cleanup', candidates: saved.affectedRows, removed: deleted.affectedRows, backupTable };
    } catch (error) { await connection.rollback(); throw error; }
  } finally { connection.release(); }
}
