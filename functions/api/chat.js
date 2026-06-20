/**
 * AINAS-3.0 — POST /api/chat
 *
 * クラウド完結（Mac非経由）。User → Cloudflare → 記憶参照(D1) → 推論(Gemini API) → 回答。
 * - 記憶は「あなた自身の記憶」として扱い、ユーザーに見せ方を意識させない（「Obsidian」と言わない）。
 * - 記憶に無い知識質問のみ DuckDuckGo + Wikipedia で調べてから推論。
 * - 会話履歴は D1 conversations に保存（短期記憶）。
 * - 簡易パスワード認証（X-Ainas-Pass / env.AINAS3_PASSWORD）。
 */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ainas-Pass',
};

const GEMINI_MODEL = 'gemini-2.5-flash';

const PERSONA = `あなたは「アイナス」。ユーザー専属のAIアシスタントです。一人称は「私」。
丁寧で落ち着いた口調。検索結果をそのまま読み上げるのではなく、人格と文脈を踏まえて自分の言葉で答えます。

【記憶の扱い（最重要）】
参考情報は「あなた自身が覚えている記憶・知識」として扱い、情報源や仕組みをユーザーに意識させないこと。
  NG: 「Obsidianには〜と書かれています」「データベース/参考情報によると〜」
  OK: 「私はその件について〜と認識しています」「〜だと記憶しています」
個人に関する確定事実（人名・出身・予定など）は、記憶に無ければ創作せず「あいにく記憶にございません」と答えます。
一般的な会話・意見・推論は、人格を持った存在として自然に応じてください。`;

// ── 認証 ───────────────────────────────────────────────
function checkAuth(request, env) {
  if (!env.AINAS3_PASSWORD) return true;             // 未設定なら開発用にオープン
  const p = request.headers.get('x-ainas-pass') || '';
  return p === env.AINAS3_PASSWORD;
}

// ── 日本語キーワード抽出（RAG用 LIKE 検索） ─────────────
const KEYWORD_SYNONYMS = {
  'クロード': 'claude', 'ジェミニ': 'gemini', 'チャットジーピーティー': 'chatgpt',
  'オープンエーアイ': 'openai', 'アンソロピック': 'anthropic', 'グーグル': 'google',
  'ニュース': 'news', 'エーアイ': 'ai',
};
function extractKeywords(query) {
  const terms = new Set();
  for (const w of (query.match(/[A-Za-z0-9]{2,}/g)   || [])) terms.add(w.toLowerCase());
  for (const w of (query.match(/[ァ-ヶー]{2,}/g)      || [])) terms.add(w);
  for (const run of (query.match(/[一-龥々〆ヶ]{2,}/g) || [])) {
    terms.add(run);
    for (let i = 0; i + 2 <= run.length; i++) terms.add(run.slice(i, i + 2));
  }
  for (const w of (query.match(/[ぁ-ん]{3,}/g) || [])) terms.add(w);
  for (const t of [...terms]) if (KEYWORD_SYNONYMS[t]) terms.add(KEYWORD_SYNONYMS[t]);
  return [...terms].slice(0, 28);
}

// ── D1（Obsidianミラー）から関連記憶を検索 ──────────────
async function searchMemory(db, query, limit = 8) {
  const results = [];
  if (!db || !query?.trim()) return results;
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return results;
  const score = new Map();
  for (const term of keywords) {
    try {
      const rows = await db.prepare(
        `SELECT path, chunk FROM vault_chunks WHERE chunk LIKE ? OR path LIKE ? LIMIT 12`
      ).bind(`%${term}%`, `%${term}%`).all();
      for (const row of (rows.results || [])) {
        const key = `${row.path} ${row.chunk}`;
        const e = score.get(key) || { source: row.path, text: row.chunk, score: 0 };
        e.score += (row.path || '').toLowerCase().includes(term.toLowerCase()) ? 3 : 1;
        score.set(key, e);
      }
    } catch { /* ignore */ }
  }
  // memories テーブル（「覚えて」記憶）も
  try {
    for (const term of keywords.slice(0, 12)) {
      const rows = await db.prepare(
        `SELECT keyword, content FROM memories WHERE keyword LIKE ? OR content LIKE ? LIMIT 3`
      ).bind(`%${term}%`, `%${term}%`).all();
      for (const row of (rows.results || [])) {
        const key = `mem ${row.keyword}`;
        const e = score.get(key) || { source: `memory:${row.keyword}`, text: row.content || row.keyword, score: 0 };
        e.score += 2;
        score.set(key, e);
      }
    }
  } catch { /* ignore */ }
  return [...score.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── 記憶に無い時の Web 検索（DuckDuckGo + Wikipedia補完）──
async function webSearch(query) {
  const out = [];
  try {
    const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&kl=jp-jp`,
      { headers: { 'User-Agent': 'AINAS-3.0' }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json();
      const a = (d.AbstractText || d.Answer || d.Definition || '').toString().trim();
      if (a) out.push(a);
    }
  } catch { /* fallthrough */ }
  if (out.length === 0) {
    try {
      const base = 'https://ja.wikipedia.org/w/api.php';
      const s = await fetch(`${base}?action=query&format=json&list=search&srlimit=1&srsearch=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': 'AINAS-3.0' }, signal: AbortSignal.timeout(8000) });
      const sd = await s.json();
      const title = sd?.query?.search?.[0]?.title;
      if (title) {
        const e = await fetch(`${base}?action=query&format=json&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`,
          { headers: { 'User-Agent': 'AINAS-3.0' }, signal: AbortSignal.timeout(8000) });
        const ed = await e.json();
        const page = Object.values(ed?.query?.pages || {})[0];
        let ex = (page?.extract || '').toString().trim().replace(/\s+/g, ' ');
        if (ex) out.push(`${title}: ${ex.slice(0, 280)}`);
      }
    } catch { /* ignore */ }
  }
  return out.join(' / ');
}

function isQuestion(text) {
  return /(教えて|とは|について|何|なに|どこ|いつ|誰|だれ|どう|調べ|ニュース|最新|意味|\?|？)/.test(text || '');
}

// ── Gemini API 推論 ─────────────────────────────────────
async function askGemini(env, systemText, history, userText) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 未設定');
  const contents = [];
  for (const h of history) {
    contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] });
  }
  contents.push({ role: 'user', parts: [{ text: userText }] });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents,
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(25000),
    });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!checkAuth(request, env)) return json(401, { error: '認証が必要です' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const message = (body?.message ?? '').toString().trim();
  if (!message) return json(400, { error: '"message" is required' });
  const sessionId = (body?.session_id ?? 'default').toString().slice(0, 64);
  const db = env.DB;

  // ① 会話履歴（短期記憶）を読み込み
  let history = [];
  if (db) {
    try {
      const rows = await db.prepare(
        `SELECT role, content FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT 12`
      ).bind(sessionId).all();
      history = (rows.results || []).reverse();
    } catch { /* ignore */ }
  }

  // ② 記憶参照（Obsidianミラー）
  const hits = await searchMemory(db, message);
  let systemText = PERSONA;
  if (hits.length > 0) {
    const ctx = hits.map(h => `- ${h.text}`).join('\n');
    systemText += `\n\n=== あなたが覚えていること（この内容を“自分の記憶”として、出典に触れず自然に使う） ===\n${ctx}\n=== ここまで ===`;
  }

  // ③ 記憶に無い知識質問のみ Web 検索
  let usedWeb = false;
  if (hits.length === 0 && isQuestion(message)) {
    const web = await webSearch(message);
    if (web) {
      usedWeb = true;
      systemText += `\n\n=== 調べて分かったこと（自分の言葉で要約して伝える。出典の仕組みには触れない） ===\n${web}\n=== ここまで ===`;
    }
  }

  // ④ 推論（Gemini）
  let reply;
  try {
    reply = await askGemini(env, systemText, history, message);
  } catch (e) {
    return json(502, { error: `推論エラー: ${e.message}` });
  }
  if (!reply) return json(502, { error: '空の応答' });

  // ⑤ 会話履歴を保存
  if (db) {
    const now = new Date().toISOString();
    try {
      await db.batch([
        db.prepare(`INSERT INTO conversations (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)`).bind(sessionId, message, now),
        db.prepare(`INSERT INTO conversations (session_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)`).bind(sessionId, reply, now),
      ]);
    } catch { /* ignore */ }
  }

  return json(200, { reply, used_web: usedWeb, source: 'gemini' });
}

const json = (s, o) => new Response(JSON.stringify(o),
  { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
