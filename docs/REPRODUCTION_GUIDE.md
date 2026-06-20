# 再現指南書 — ゼロから「記憶を持つAI」を作る

> 対象: プログラミング初心者。**このファイルごとAI（ChatGPT / Claude / Gemini など）に読み込ませて**、対話しながら作り上げることを想定しています。
> ゴール: 自分専用の、クラウド完結（自宅PCの起動に依存しない）AIアシスタントを公開URLで動かす。

---

## 0. これは何を作るのか（30秒で理解）

- ChatGPT風のチャット画面を持つ、**自分専属のAI**。
- 自分のメモ（Obsidian等）を「**AI自身の記憶**」として参照し、検索結果の丸出しではなく**自分の言葉で**答える。
- サーバーは **Cloudflare（無料枠で常時稼働）**、頭脳は **Gemini API**。だから**スマホだけ・PCオフでも使える**。

```
あなた(スマホ) → Cloudflare → 記憶参照(D1) → Gemini推論 → 回答
```

---

## 1. 必要なもの（すべて無料で始められる）

| 用途 | サービス | 取得先 |
|---|---|---|
| サーバー/DB | Cloudflare アカウント | https://dash.cloudflare.com/sign-up |
| AIの頭脳 | Gemini APIキー | https://aistudio.google.com/apikey |
| コード管理/公開 | GitHub アカウント | https://github.com |
| 手元の道具 | Node.js + wrangler CLI | `npm i -g wrangler` |

---

## 2. AIに渡す「最初の指示プロンプト」（コピペ用）

新しいプロジェクトをAIと始めるとき、最初にこれを貼ってください。

```text
あなたは私の開発パートナーです。これから「記憶を持つパーソナルAIアシスタント」を作ります。
要件:
- ChatGPT風のチャットUI（テキスト入力が主役）。
- 自分のメモ（Markdown）を「AI自身の記憶」として扱い、「データベースによると」等とは言わず
  「私はこう認識しています」と自分の言葉で答える。
- 最重要: 自宅PCの起動に依存しないこと。リクエスト経路にローカルPCを含めない
  （User → Cloudflare → 記憶参照 → 推論 → 回答 で完結させる）。
- バックエンドは Cloudflare Pages Functions、記憶は Cloudflare D1(SQLite)、生成は Gemini API(gemini-2.5-flash)。
- 認証は簡易パスワード（ヘッダ照合）。秘密情報はコードに書かず環境変数で渡す。
新機能を実装する前に必ず「①要件解釈 ②実装計画 ③懸念事項」を説明して、私の承認を取ってから進めてください。
```

> ポイント: 最後の一文（**承認を取ってから進める**）を入れると、AIが暴走せず一歩ずつ確認しながら作ってくれます。

---

## 3. 作る順番（フェーズ）

AIには「この順で作って」と伝えてください。

1. **Phase 0 — 土台**: リポジトリ作成、`wrangler.toml`、空のチャットページ。
2. **Phase 1 — 頭脳**: `/api/chat`（記憶参照 → 必要なら検索 → Gemini推論 → 履歴保存）。
3. **Phase 2 — 記憶の見せ方**: 「自分の記憶として話す」人格(PERSONA)の調整。
4. **Phase 3 — UI**: テキスト入力中心のチャット画面（音声入力は任意）。
5. **Phase 4 — 仕上げ**: PWA化（ホーム画面に追加できる）、アイコン、公開。

---

## 4. データベースの形（D1スキーマ）

AIに「このスキーマでD1を作って」と渡してください。中身は [`../schema.sql`](../schema.sql) と同じです。

- `vault_chunks` … メモを分割して保存（長期記憶）＋ FTS5全文検索
- `memories` … 「覚えて」で保存した記憶
- `conversations` … 直近の会話履歴（短期記憶）

```bash
wrangler d1 create my-vault
wrangler d1 execute my-vault --file=schema.sql
```

---

## 5. 頭脳の作り方（/api/chat の考え方）

実物は [`../functions/api/chat.js`](../functions/api/chat.js)。処理は5ステップ:

```
① 会話履歴をロード（D1 conversations）
② 記憶を検索（D1 vault_chunks/memories。パス一致は本文の3倍で重み付け、カナ→英の同義語で表記揺れ吸収）
③ 記憶に無い知識質問だけ Web検索（DuckDuckGo→Wikipedia）
④ Gemini で推論（記憶を“自分の記憶”として渡し、出典に触れず自然に答えさせる）
⑤ 会話履歴を保存
```

AIにはこう頼めます:
```text
chat.js を作って。日本語のキーワード抽出（漢字2-gram・カタカナ・英数字・カナ→英の同義語）で
D1を検索し、パス/タイトル一致を本文の3倍で重み付けして上位だけGeminiに渡して。
記憶は「私の記憶」として扱わせ、「Obsidianによると」とは絶対に言わせないで。
記憶に無い知識質問のときだけ DuckDuckGo→Wikipedia で調べて要約させて。
パスワードは環境変数 AINAS3_PASSWORD とヘッダ X-Ainas-Pass を照合。Gemini鍵は環境変数 GEMINI_API_KEY。
```

---

## 6. 秘密情報の入れ方（コードに書かない！）

```bash
wrangler pages secret put GEMINI_API_KEY  --project-name=my-assistant   # Geminiの鍵
wrangler pages secret put AINAS3_PASSWORD --project-name=my-assistant   # ログインPW
```
> 入力時は画面に表示されず、チャットやコードにも残りません。**鍵は絶対にコードへ直書きしない**（→ [TROUBLESHOOTING #4](TROUBLESHOOTING.md)）。

---

## 7. 公開（デプロイ）

```bash
cp wrangler.toml.example wrangler.toml      # 実IDに書き換える
wrangler pages deploy public --project-name=my-assistant
```
→ `https://my-assistant.pages.dev` で公開。スマホで開いて「ホーム画面に追加」でアプリ化。

---

## 8. 動作確認（疎通テスト）

```bash
# 誤パスワード → 401 が返れば認証は有効
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://my-assistant.pages.dev/api/chat \
  -H "Content-Type: application/json" -H "X-Ainas-Pass: wrong" -d '{"message":"test"}'
```
あとはブラウザでログインして「こんにちは」と送り、返事が来れば完成。

---

## 9. つまずいたら
よくある不具合と対策は [TROUBLESHOOTING.md](TROUBLESHOOTING.md) に全部あります。
エラーメッセージをそのままAIに貼って「これ直して」と言えば、たいてい解決します。

---

## 10. 公開前の最終チェック（重要）
- [ ] コード・履歴に秘密情報が無い（`grep -rniE "password|api[_-]?key|sk-|AIza"`）
- [ ] `git config user.name/email` が自分になっている
- [ ] 実データ・本番資格情報を含む本体はPrivate、公開は仕組みだけの複製リポ
- [ ] PCオフ・外出先でも動く（クラウド完結）ことを実機で確認した
