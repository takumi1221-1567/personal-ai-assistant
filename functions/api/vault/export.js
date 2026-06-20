/**
 * GET /api/vault/export  — 端末内RAG用に記憶(vault_chunks)を全件JSONで返す。
 * 認証: ヘッダ X-Ainas-Pass === env.AINAS3_PASSWORD（チャットと同じパスワード）。
 *
 * iPhoneアプリ(あいなすネイティブ版)が初回/手動同期でこれを取得し、端末内に保存して
 * オフラインでも記憶参照できるようにする。Vaultは小さい（~337件・<1MB）ので全件返す。
 */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ainas-Pass',
};
const json = (s, o) => new Response(JSON.stringify(o),
  { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return json(405, { error: 'Method Not Allowed' });

  if (!env.AINAS3_PASSWORD || request.headers.get('x-ainas-pass') !== env.AINAS3_PASSWORD) {
    return json(401, { error: '認証が必要です' });
  }
  const db = env.DB;
  if (!db) return json(503, { error: 'DB unavailable' });

  const chunks = [];
  try {
    const rows = await db.prepare('SELECT path, chunk FROM vault_chunks').all();
    for (const r of (rows.results || [])) {
      if (r.chunk) chunks.push({ path: r.path || '', chunk: r.chunk });
    }
  } catch (e) {
    return json(500, { error: `query failed: ${e.message}` });
  }

  return json(200, { count: chunks.length, synced_at: new Date().toISOString(), chunks });
}
