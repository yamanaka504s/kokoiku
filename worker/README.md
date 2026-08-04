# APIキー中継サーバー セットアップ手順

APIキーをブラウザに置かず、Cloudflare Worker（中継サーバー）の中だけで保持するための手順です。

**所要時間の目安：30〜40分。作業は初回だけです。**

```
【今まで】
ブラウザ（キー入り＝誰でも取り出せる） ──→ api.anthropic.com

【これから】
ブラウザ（キーなし） ──→ Cloudflare Worker（キー保管） ──→ api.anthropic.com
                                                       └→ api.openai.com
```

利用する職員側の操作は今までと**一切変わりません**。URLも同じ、ログインもありません。

---

## 事前に知っておくこと

- **中継サーバーは全アプリ共通で1個で足ります。** ココイクも誕生日計画も他のアプリも、公開先はすべて `https://yamanaka504s.github.io` なので、1つの Worker を全部から呼べます。この手順は最初の1回だけです。
- **現在のAPIキーは公開状態です。** 公開リポジトリとGitHub Pagesの両方にソースが出ているため、取り出そうと思えば誰でも取り出せます。そのため手順1でキーを作り直します。
- 費用はかかりません（Cloudflare Workers の無料枠は1日10万リクエスト。実利用では到底届きません）。

---

## 手順1：APIキーを作り直す

現在のキーは公開済みなので、**新しいキーを発行し、古いキーは最後に無効化します**。

1. **Anthropic** … https://console.anthropic.com/settings/keys
   - 「Create Key」で新しいキーを作成し、控えておく（`sk-ant-api03-...`）
   - ※ 古いキーはまだ消さないこと（手順7で無効化します）
2. **OpenAI** … https://platform.openai.com/api-keys
   - 同様に新しいキーを作成し、控えておく（`sk-proj-...`）

あわせて、**使いすぎ防止の上限額**を設定しておくと安心です。
- Anthropic：Settings → Limits
- OpenAI：Settings → Limits → Budgets

---

## 手順2：Cloudflare のアカウントを作る

https://dash.cloudflare.com/sign-up からメールアドレスで登録します。クレジットカードの登録は不要です。

---

## 手順3：Worker を作る

1. 左メニューの **Compute (Workers)** → **Workers & Pages** を開く
2. **Create application** → **Start with Hello World!**（テンプレートから作成）を選ぶ
3. 名前を **`kokoiku-api`** にして **Deploy** を押す
   - デプロイ後に表示される `https://kokoiku-api.〇〇〇.workers.dev` が**中継サーバーのURL**です。**必ず控えてください**（手順6で使います）
4. **Edit code** を押してブラウザ上のエディタを開く
5. 既存のコードをすべて消し、このフォルダの **`worker.js` の中身をまるごと貼り付け**て **Deploy**

> CLI（wrangler）に慣れている場合は `npx wrangler deploy worker/worker.js --name kokoiku-api` でも構いません。

---

## 手順4：APIキーを登録する

1. Worker の画面で **Settings** タブ → **Variables and Secrets** を開く
2. **Add** を押し、種類に **Secret** を選んで以下の2つを登録する

   | Variable name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | 手順1で作った Anthropic の新しいキー |
   | `OPENAI_API_KEY` | 手順1で作った OpenAI の新しいキー |

3. **Deploy** を押して反映

> Secret は登録後に画面から読み出せません（Cloudflareの仕様）。控えは手元に残しておいてください。

---

## 手順5（任意）：1日の利用上限をつける

巡回ボットに見つかった場合の請求暴走を防ぐ設定です。**やらなくても動きます**が、5分で終わるので推奨します。

1. 左メニュー **Storage & Databases** → **KV** → **Create a namespace**
   - 名前は何でもよい（例：`kokoiku-counter`）
2. Worker の **Settings** → **Bindings** → **Add** → **KV namespace**
   - **Variable name** に **`COUNTER`** と入力（この名前でないと機能しません）
   - 作成したネームスペースを選んで保存
3. 上限回数を変えたい場合は **Variables and Secrets** に種類 **Text** で `DAILY_LIMIT` を追加（未設定なら500回／日、日本時間0時にリセット）

上限に達すると、職員の画面に「本日の利用上限に達しました」と表示されます。

---

## 手順6：動作確認 → アプリを切り替える

1. ブラウザで **`https://kokoiku-api.〇〇〇.workers.dev/health`** を開く
   - `{"ok":true,"anthropic_key":true,"openai_key":true,...}` と出れば成功
   - `false` が出ていたら手順4のキー登録を見直す
2. `index.html` の**先頭付近にある `API_BASE`** を、控えたURLに書き換える

   ```javascript
   const API_BASE = 'https://kokoiku-api.XXXXX.workers.dev';   // ← ここを実際のURLに
   ```
   ※ 末尾のスラッシュは付けないこと

3. 変更を公開する（`api-proxy` ブランチで作業しているので master に統合する）

   ```
   git add index.html
   git commit -m "APIキーを中継サーバー方式に変更"
   git checkout master
   git merge api-proxy
   git push origin master
   ```

4. 1〜2分待ってから公開サイトを **Ctrl+F5** で開き直し、AI文章生成とイラスト生成が動くことを確認する

---

## 手順7：古いキーを無効化する

**動作確認できてから**、手順1のコンソールで**古いキーを Revoke（削除）**します。これで、公開されてしまったキーは使えなくなります。

---

## 手順8：他のアプリも切り替える（順次でOK）

姉妹アプリ（誕生日計画ほか）も、**同じ中継サーバーをそのまま使えます**。各アプリの `index.html` で

- キー定義（`_j`, `DEFAULT_API_KEY`, `OPENAI_API_KEY`）を削除
- `API_BASE` を追加し、`fetch` 先を中継サーバーに変更

とすれば同じ構成になります。Worker 側の追加作業はありません。

---

## 困ったときは

| 症状 | 確認すること |
|---|---|
| 生成ボタンを押しても何も起きない | ブラウザのF12（開発者ツール）→ Console にエラーが出ていないか。`API_BASE` のURLが正しいか |
| 「APIエラーが発生しました」 | `/health` を開いてキーが `true` か。Anthropic/OpenAI の残高・上限額 |
| CORSエラーが出る | 公開元のURLが `worker.js` の `DEFAULT_ORIGINS` に入っているか。別ドメインから使う場合は `ALLOWED_ORIGINS` を Text 変数で追加 |
| 「本日の利用上限」と出る | 手順5の `DAILY_LIMIT` を増やす。翌0時（日本時間）に自動リセット |
| モデルが使えないと言われる | `worker.js` の `ALLOWED_CLAUDE_MODEL` は sonnet / haiku のみ許可。他を使うならここを編集 |

---

## 仕組みのメモ（次の担当者向け）

- ブラウザ → Worker の経路には認証がありません。URLを知っていれば誰でも呼べます（社内利用のため許容する判断）。ただし**キーそのものは取り出せない**ため、悪用されてもこのアプリの機能の範囲に限定され、Worker を止めれば即座に遮断できます。
- あとから合言葉やCloudflare Accessによる認証を足すことも可能です。その場合も変更は Worker 側の1箇所で済みます。
- `worker.js` にキーは含まれていないので、公開リポジトリに入れて問題ありません。
