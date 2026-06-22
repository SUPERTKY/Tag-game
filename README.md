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
   - `TAG_GAME_PASSWORD`: Cloudflare で作った入室用パスワード（Secret として登録推奨）
   - `TAG_GAME_USERNAME`: 入室用ユーザー名（省略した場合は `player`）
   - `TAG_GAME_ADMIN_PASSWORD`: Cloudflare で作った管理者画面用パスワード（Secret として登録推奨）
   - より安全にハッシュで運用したい場合は、`TAG_GAME_PASSWORD` の代わりに `TAG_GAME_PASSWORD_HASH`、`TAG_GAME_ADMIN_PASSWORD` の代わりに `TAG_GAME_ADMIN_PASSWORD_HASH` を登録します。
5. Deploy を実行します。


## Cloudflare に登録する変数名

このサイトを開くと、ブラウザがユーザー名とパスワードを聞いてきます。Cloudflare には次の 2 つを登録してください。

| 変数名 | Type | 入れる値の例 | 説明 |
| --- | --- | --- | --- |
| `TAG_GAME_PASSWORD` | Secret | `自分で作った入室パスワード` | サイトに入るときのパスワードです。Cloudflare で作ったパスワードをここに入れてください。 |
| `TAG_GAME_USERNAME` | Text | `player` | 省略できます。省略した場合、ユーザー名は `player` になります。 |
| `TAG_GAME_ADMIN_PASSWORD` | Secret | `自分で作った管理者パスワード` | 待機画面左下の管理者ボタンから管理者画面へ入るときのパスワードです。Cloudflare で作ったパスワードをここに入れてください。 |

### Cloudflare Dashboard での追加手順

1. Cloudflare Dashboard を開きます。
2. **Workers & Pages** を開きます。
3. このサイトの Pages プロジェクト（例: `tag-game`）を選びます。
4. **Settings** を開きます。
5. **Variables and Secrets** を開きます。
6. **Add** または **Add variable** を押します。
7. まずパスワード用の変数を次のように追加します。
   - Type: `Secret`
   - Variable name: `TAG_GAME_PASSWORD`
   - Value: Cloudflare で作ったパスワード
8. 管理者画面用のパスワードも次のように追加します。
   - Type: `Secret`
   - Variable name: `TAG_GAME_ADMIN_PASSWORD`
   - Value: Cloudflare で作った管理者パスワード
9. ユーザー名を変えたい場合だけ、次の変数も追加します。追加しない場合のユーザー名は `player` です。
   - Type: `Text`
   - Variable name: `TAG_GAME_USERNAME`
   - Value: `player` など、ログインに使いたいユーザー名
10. **Deploy** を押して反映します。
11. 反映後、サイトにアクセスして、ユーザー名 `player`（変更した場合はその値）と手順 7 の入室パスワードでログインします。待機画面左下の管理者ボタンでは、手順 8 の管理者パスワードを入力します。

> `Authentication username is not configured.` が出た場合でも、最新版では `TAG_GAME_USERNAME` を追加しなくてもユーザー名 `player` で入れるようにしています。パスワードは必ず `TAG_GAME_PASSWORD` に入れてください。`TAG_GAME_PASSWORD_HASH` は上級者向けの代替方法なので、まずは使わなくて大丈夫です。

## 安全なパスワードハッシュの作り方

Cloudflare で作ったパスワードをそのまま使う場合は、入室用は `TAG_GAME_PASSWORD`、管理者画面用は `TAG_GAME_ADMIN_PASSWORD` に Secret として登録してください。

より安全に運用したい場合は、平文パスワードの代わりに `salt:hash` 形式の PBKDF2-SHA-256 ハッシュを、入室用は `TAG_GAME_PASSWORD_HASH`、管理者画面用は `TAG_GAME_ADMIN_PASSWORD_HASH` に保存できます。

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

1. `.dev.vars.example` をコピーして `.dev.vars` を作ります。
2. `.dev.vars` の `TAG_GAME_USERNAME`、`TAG_GAME_PASSWORD`、`TAG_GAME_ADMIN_PASSWORD` を好きな値に書き換えます。
3. 次のコマンドを実行します。

```bash
npx wrangler pages dev .
```
