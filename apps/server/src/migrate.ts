import { MySqlDatabase, mysqlPool } from './mysql';
import { DatabaseSync, backup } from 'node:sqlite';
import { resolve } from 'node:path';
import { readLegacy, legacyCounts, migrateLegacy } from './migration';
async function main() {
  const args=process.argv.slice(2),source=args.find(a=>a.startsWith('--source='))?.slice(9);
  if(!source||args.some(a=>a!=='--confirm'&&a!=='--dry-run'&&!a.startsWith('--source=')))throw new Error('Usage: db:migrate -- --source=<SQLite path> [--dry-run|--confirm]');
  if(args.includes('--dry-run')&&args.includes('--confirm'))throw new Error('Choose dry-run or confirm, not both');
  if(args.includes('--confirm')) {
    const connection=new DatabaseSync(resolve(source),{readOnly:true});
    const backupPath=resolve(source)+'.backup-'+Date.now()+'.sqlite';
    try{await backup(connection,backupPath);console.log('SQLite backup created: '+backupPath);}finally{connection.close();}
  }
  const snapshot=readLegacy(source);
  console.log(JSON.stringify({mode:args.includes('--confirm')?'import':'dry-run',counts:legacyCounts(snapshot)}));
  if(!args.includes('--confirm'))return;
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
  const db=new MySqlDatabase(mysqlPool(process.env.DATABASE_URL));
  try {await migrateLegacy(db,snapshot);console.log('Migration committed and verified. Source SQLite was not modified.');}
  finally {await db.close();}
}
main().catch(()=>{console.error('Migration failed; no successful import is claimed. Check source validity, empty target, permissions and DATABASE_URL. Credentials and row contents are intentionally not logged.');process.exitCode=1;});
