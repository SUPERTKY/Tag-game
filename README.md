# Tag Game

Cloudflare Pages に公開できる、パスワード保護付きの静的 2D フィールド移動ゲームです。

## Cloudflare Pages でオンライン公開する手順

1. このリポジトリを GitHub に push します。
2. Cloudflare Dashboard で **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** を選びます。
3. ビルド設定は次の通りです。
   - Framework preset: `None`
   - Build command: 空欄
   - Build output directory: `/`
4. **Settings** → **Environment variables** に次の値を登録します。
   - `TAG_GAME_USERNAME`: 入室用ユーザー名
   - `TAG_GAME_PASSWORD`: Cloudflare で作った入室用パスワード（Secret として登録推奨）
   - より安全にハッシュで運用したい場合は、`TAG_GAME_PASSWORD` の代わりに `TAG_GAME_PASSWORD_HASH` を登録します。
5. Deploy を実行します。

## 安全なパスワードハッシュの作り方

Cloudflare で作ったパスワードをそのまま使う場合は、`TAG_GAME_PASSWORD` に Secret として登録してください。

より安全に運用したい場合は、平文パスワードの代わりに `salt:hash` 形式の PBKDF2-SHA-256 ハッシュを `TAG_GAME_PASSWORD_HASH` に保存できます。

```bash
node -e "const crypto=require('crypto');const password=process.argv[1];const salt=crypto.randomBytes(16);const hash=crypto.pbkdf2Sync(password,salt,210000,32,'sha256');console.log(salt.toString('base64')+':'+hash.toString('base64'));" 'ここに強いパスワードを入れる'
```

### 36人向けのパスワード運用

- 16文字以上で、大文字・小文字・数字・記号を混ぜたランダムなパスワードを使ってください。
- 36人全員に同じ共有パスワードを配る場合、誰かが外部へ共有すると全員分の入室権限が漏れます。イベント後、または参加者が変わったら必ず `TAG_GAME_PASSWORD` または `TAG_GAME_PASSWORD_HASH` を更新してください。
- 参加者ごとに個別アカウントや追跡可能なログインが必要な場合は、Cloudflare Access を併用するのがより安全です。

## ローカルで確認する

静的ファイルだけを確認する場合:

```bash
python3 -m http.server 8000
```

Cloudflare Pages Functions のパスワード保護まで確認する場合:

```bash
npx wrangler pages dev .
```
