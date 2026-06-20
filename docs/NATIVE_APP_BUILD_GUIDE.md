# ネイティブiOSアプリ 作り方手順書（初心者向け・実機まで）

iPhone単体で動く端末内AIアプリを **ゼロから実機で動かす**までの全手順。
プログラミング初心者でも追えるよう、実際に詰まったポイントも含めて丁寧に書いています。

> ソースは [`../ios/`](../ios/) にあります（5ファイル）。これをXcodeに入れて使います。
> 仕様は [NATIVE_APP_SPEC.md](NATIVE_APP_SPEC.md)、使い方は [NATIVE_APP_USAGE.md](NATIVE_APP_USAGE.md) を参照。

---

## 0. 用意するもの
- **Mac**（Xcodeを動かす。空き容量 30GB以上が安心）
- **Xcode**（App Storeから無料）
- **iPhone**（A16以降＝iPhone 15以降推奨。3Bモデルにはメモリ6GB+が安心）
- **無料の Apple ID**（自分だけで使うなら課金不要）
- ケーブル（初回ビルド転送用）

> 💡 Macの空き容量が足りない時は、不要キャッシュ・未使用アプリ・古いiOSシミュレータを整理。
> 音楽ライブラリやプロジェクトなど大事なものは消さないこと。

---

## ステップ① プロジェクトを作る
1. Xcode →「Create New Project…」→ 上タブ **iOS** → **App** → Next
2. 入力:
   - Product Name: **Ainas**
   - Organization Identifier: 例 `com.yourname`（→ Bundle ID は `com.yourname.Ainas`）
   - Interface: **SwiftUI** / Language: **Swift** / Storage: **None**
3. 保存場所を選んで Create → 左にファイル一覧、中央にコードが出れば成功。

## ステップ② AIエンジン(MLX)を追加
1. メニュー **File → Add Package Dependencies…**
2. 右上の検索欄に貼り付け:
   ```
   https://github.com/ml-explore/mlx-swift-examples
   ```
3. **Add Package** → 製品の選択で **MLXLLM** と **MLXLMCommon** にチェック → Add Package
   - 解決に数分かかることあり。完了すると左に「Package Dependencies」が増える。

## ステップ③ コードを入れる
[`../ios/`](../ios/) の5ファイルを使います。`AinasApp` / `ContentView` は既存を**全選択→削除→貼り付け**で置き換え、`AinasEngine` / `ChatMessage` / `VaultStore` は**新規ファイル**として追加。

新規ファイルの作り方：黄色い「Ainas」フォルダを右クリック → New File from Template → **Swift File** → 名前を入力 → 中身を貼り付け。

> 接続先URLは `ContentView.swift` の `baseURL` を、自分のクラウド（Web版）のURLに変更します。

## ステップ④ メモリ上限を上げる（3Bを安定させる肝）
1. 左の青い「Ainas」→ TARGETS の「Ainas」→ **Signing & Capabilities** タブ
2. 左上 **+ Capability** → 検索 `Increased Memory Limit` → ダブルクリックで追加

## ステップ⑤ 署名（Apple IDで動かす許可）
1. 同じ **Signing & Capabilities** で **Automatically manage signing** にチェック
2. **Team** で自分の Apple ID（無ければ「Add an Account…」でサインイン）→「(名前) (Personal Team)」を選ぶ
3. 「Unable to log in」等が出たら **Sign In…** で入り直す。"No profiles…" はログインが通れば自動解消。

## ステップ⑥ 最低iOSバージョンを下げる
1. **General** タブ → **Minimum Deployments** の iOS を、iPhoneのiOSと同じか低い値（例 **17.0**）に。
   - 高すぎると「Upgrade … or lower deployment target」エラーになる。

## ステップ⑦ iPhone側「デベロッパモード」をON
1. iPhone **設定 → プライバシーとセキュリティ → デベロッパモード** を ON → 再起動 → 起動後「オンにする」
   - 自作アプリの実行に必須（リモートでは有効化できない安全設計）。

## ステップ⑧ 実機で起動
1. iPhoneをケーブルで接続（「このコンピュータを信頼」→ パスコード）
2. Xcode上部の実行先で **自分のiPhone** を選ぶ（"Simulator" でない方）
3. 左上 **▶︎** → 初回ビルドは数分（MLXが大きい）
4. 初回は「**信頼されていないデベロッパ**」が出る → iPhone **設定 → 一般 → VPNとデバイス管理 →
   自分のApple IDを「信頼」** → もう一度 ▶︎ かアプリアイコンをタップ
5. 「モデルを準備しています…」→ 初回はモデルDL（約1.8GB・Wi-Fi推奨）→「おかえりなさいませ。」で成功 🎉

## ステップ⑨ 記憶を同期（RAGを有効化）
1. アプリ右上の **🔄** をタップ
2. 接続先URLと **パスワード**（Web版のログインPW）を入力 → **記憶を同期する**
3. 「✅ 同期完了：記憶 N件」と出れば、以降は**オフラインでもメモを参照**して答える。

---

## つまずきポイント集（実際に出たもの）
| 症状 | 原因 / 対処 |
|---|---|
| `Type '…' does not conform to 'ObservableObject'` / `@Published … missing import 'Combine'` | ファイル冒頭に **`import Combine`** を1行追加（Xcodeの "Apply" でも可） |
| `Upgrade … or lower deployment target` | ⑥でMinimum Deploymentsを下げる（例 17.0） |
| `Developer Mode disabled` | ⑦でデベロッパモードをON |
| 信頼されていないデベロッパ | ④の手順で自分のApple IDを「信頼」 |
| iOSシミュレータ(数GB)を勝手にDLし始める | 実機運用なら不要。ただし実機のiOS版に対応する部品（platform）が要る場合は「Get」で入れる |
| アプリが起動直後に落ちる | メモリ不足。`AinasEngine.modelId` を `Qwen2.5-1.5B-Instruct-4bit` に変更 |
| 数日で起動しなくなる | 無料署名は約7日で失効。Macに繋いで ▶︎ で再署名（Wi-Fi接続でも可）。長期運用は $99/年 + TestFlight |
| ビルドがとても長い | 初回は正常（MLXのコンパイル）。2回目以降は速い |

---

## 補足（運用）
- 自作アプリは **デベロッパモードON維持** が必要（OFFにするとアプリが起動しない）。
- 無料署名は **約7日ごとに再Run** が必要。ケーブルが面倒なら、一度ケーブル接続中に
  Xcode → Window → Devices and Simulators で**ネットワーク接続**を有効化すればWi-Fiで再署名可能。
