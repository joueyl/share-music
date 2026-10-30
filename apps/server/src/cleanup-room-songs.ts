import { mysqlPool } from './mysql';
import { cleanupRoomSongCopies } from './room-song-cleanup';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--dry-run', '--confirm'].includes(a)) || args.includes('--dry-run') && args.includes('--confirm')) throw new Error('Invalid arguments');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = mysqlPool(process.env.DATABASE_URL);
  try { console.log(JSON.stringify(await cleanupRoomSongCopies(pool, args.includes('--confirm')))); }
  finally { await pool.end(); }
}
main().catch(() => {
  console.error('Room song cleanup failed. Stop the service and check database schema, permissions and DATABASE_URL. No successful cleanup is claimed; row contents and credentials are not logged.');
  process.exitCode = 1;
});
