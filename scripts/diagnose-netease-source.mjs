import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const detailRoute = '/api/v3/song/detail';
const sourceRoute = '/api/song/enhance/player/url';
const numeric = value => typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 100000 ? value : undefined;

/** One anonymous metadata batch. Never load application configuration or stored sessions. */
export async function diagnoseNeteaseSource(songId, request) {
  if (typeof songId !== 'string' || !/^[1-9]\d{0,19}$/.test(songId)) throw new Error('INVALID_SONG_ID');
  let stage = 'sdk_load';
  try {
    if (!request) {
      const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
      request = (await import(pathToFileURL(require.resolve('hana-music-api')).href)).createRequest;
    }
    stage = 'request';
    const result = await request('/api/batch', {
      [detailRoute]: JSON.stringify({ c: `[{"id":${songId}}]` }),
      [sourceRoute]: JSON.stringify({ ids: JSON.stringify([songId]), br: 128000 }),
    }, { cookie: '', timeoutMs: 15000, retry: { retries: 0, retryNonIdempotent: false } });
    const body = result?.body, detail = body?.[detailRoute], source = body?.[sourceRoute];
    const items = Array.isArray(source?.data) ? source.data : [];
    const audio = items.find(item => String(item?.id) === songId);
    const accepted = body?.code === 200 && detail?.code === 200 && Array.isArray(detail?.songs) && source?.code === 200 && Array.isArray(source?.data);
    return {
      mode: 'anonymous', outcome: accepted ? 'metadata_received' : 'response_rejected',
      sdkStatus: numeric(result?.status), rootCode: numeric(body?.code), detailCode: numeric(detail?.code), sourceCode: numeric(source?.code),
      songReturned: Array.isArray(detail?.songs) && detail.songs.some(song => String(song?.id) === songId),
      audioReturned: !!audio, audioCode: numeric(audio?.code), hasAudioUrl: typeof audio?.url === 'string' && audio.url.length > 0,
      trialOnly: !!audio?.freeTrialInfo,
    };
  } catch (error) {
    return { mode: 'anonymous', outcome: 'request_failed', stage, sdkStatus: numeric(error?.status), bodyCode: numeric(error?.body?.code) };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !/^[1-9]\d{0,19}$/.test(args[0])) {
    process.stderr.write('用法：node <项目绝对路径>/scripts/diagnose-netease-source.mjs <歌曲数字ID>\n仅做一次空 Cookie 元数据请求，不读取 .env、数据库或保存的凭据。\n');
    process.exitCode = 1;
  } else {
    const result = await diagnoseNeteaseSource(args[0]);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.outcome === 'metadata_received' ? 0 : 2;
  }
}
