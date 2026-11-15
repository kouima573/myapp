# 素材サイトへの問い合わせ文（4通・送信はあなたが行います）

**送る前に置き換えるのは2か所だけ**: `【公開URL】`（`pnpm deploy:site` で表示されるURL。例: https://rpg-studio.pages.dev）と、末尾の名前・連絡先。

| # | 宛先 | 送り方 | 何がはっきりするか |
| --- | --- | --- | --- |
| 1 | OpenTracks（旧DOVA-SYNDROME） | https://opentracks.com/help/ の「お問い合わせ」から（フォームの場所は未確認） | HTML5で書き出すゲームに曲を入れてよいか・その条件 |
| 2 | 効果音ラボ | https://soundeffect-lab.info/faq/ から問い合わせページへ（フォームの場所は未確認） | 公開GitHubで音源を管理してよいか |
| 3 | Freesound（英語） | メール: mtg@upf.edu（API規約に記載の連絡先とされる。送る前にAPI規約ページで確認） | APIを無料で使えるか（ゲームを売る人がいても非商用扱いか） |
| 4 | itch.io（英語） | https://itch.io/support から（場所は未確認） | 購入済みパックの一覧を読む連携と、ダウンロードの扱い |

返事が来たら、その文面をAI（Codex／Claude Code）に貼って「取得元カタログに反映して」と頼んでください。

---

## 1. OpenTracks（旧DOVA-SYNDROME）— ブラウザゲームでの組み込み条件

宛先: OpenTracks ヘルプページ内のお問い合わせ窓口（https://opentracks.com/help/ から。フォームのURLは調査時に未確認）

> 件名: ブラウザ（HTML5）ゲームでの音源の組み込み方法について
>
> OpenTracks ご担当者様
>
> いつも素敵な音源を公開していただき、ありがとうございます。
> 個人で、RPGを作るための無料ツール「RPGシステム工房」（【公開URL】）を開発しています。このツールで作ったゲームはブラウザ向けのHTML5形式で書き出し、itch.io などで公開する想定です。
>
> 「ゲーム・TRPGでの利用」のページと、2026年11月13日の公式Xでのご案内を拝見しました。そのうえで、次の3点を教えていただけますでしょうか。
>
> 1. HTML5ゲームでは、仕組みの都合上、ブラウザの開発者ツールを使えば音源ファイル（OGG/MP3）を取り出せてしまいます。この場合、「条件を満たすのが難しい場合」の3点を満たせば、通常ライセンスの範囲で利用できるという理解でよろしいでしょうか。その3点の具体的な内容も教えてください。
> 2. ゲームのソースを GitHub などの公開リポジトリで管理し、音源ファイルもそこに含めることは、「音源を取り出せる状態」や再配布にあたりますか（非公開リポジトリなら問題ないか、もあわせて伺えれば幸いです）。
> 3. ツールのほうで、ゲーム内のクレジット画面と同梱の CREDITS ファイルに「曲名・作曲者名・OpenTracks・曲ページURL」と「音源の抽出・転用を禁止する旨」を自動で記載する予定です。この表記で足りますか。
>
> お忙しいところ恐れ入りますが、ご回答いただけますと幸いです。
> <氏名・連絡先>

---

## 2. 効果音ラボ — 公開リポジトリ・ブラウザゲームでの扱い

宛先: 効果音ラボのお問い合わせ窓口（FAQ https://soundeffect-lab.info/faq/ から。フォームのURLは調査時に未確認）

> 件名: ゲーム制作ツールでの効果音の扱いについて（公開リポジトリ・HTML5）
>
> 効果音ラボ ご担当者様
>
> いつも効果音を使わせていただき、ありがとうございます。
> 個人で、RPGを作るための無料ツール「RPGシステム工房」（【公開URL】）を開発しています。利用者が効果音ラボからダウンロードした効果音を、自分のゲームに組み込むための記録（入手元URL・規約確認日など）をつける機能があります。ツール自体には効果音ラボの音源を含めず、サイトへの自動アクセスや一括ダウンロードも行いません。
>
> 利用規約とFAQを拝見したうえで、次の2点を教えていただけますでしょうか。
>
> 1. 利用者が作ったゲームのデータ（音源ファイルを含む）を、GitHub の公開リポジトリに置くことは、再配布にあたりますか。非公開リポジトリであれば問題ないでしょうか。
> 2. ブラウザ（HTML5）ゲームとして公開すると、技術的に音源ファイルを隠すことが難しいのですが、FAQにある「できる限りでよいので隠す措置」は、ゲーム内に「音源の抜き出し・転用禁止」と明記する程度でもよろしいでしょうか。
>
> ご回答いただけますと幸いです。
> <氏名・連絡先>

---

## 3. Freesound — API/OAuth2 integration in a free game-making tool (English)

To: mtg@upf.edu (the contact named in the Freesound API terms of use)

> Subject: API use question: free, open-source game-making tool (OAuth2 downloads by end users)
>
> Dear Freesound team,
>
> Thank you for running Freesound. I am developing "RPG System Studio (RPGシステム工房)" (【公開URL】), a free tool for making small 2D RPGs. I would like to let its users search Freesound and add sounds to their own games, and I want to make sure this fits the API Terms of Use.
>
> Planned design:
> - Each user requests their own API credential and signs in with OAuth2. The tool stores the user's token only on the user's own machine; we run no server.
> - Searches use the API and show the sound page URL and preview so the user can choose. The original file is downloaded only after the user confirms a specific sound, within your rate limits.
> - CC BY-NC sounds are excluded by default. The license, author, sound name and URL are recorded for each sound and shown in the game's credits.
> - We do not mirror, cache or redistribute Freesound's catalogue (only the user's chosen files end up in the user's game).
>
> Questions:
> 1. Is this "non-commercial" use of the API when the tool is free, even though some users may sell the games they make? If not, what licensing would apply?
> 2. Is it acceptable for each user to use their own API credential this way, or should the tool register a single application?
> 3. May the tool cache search results/metadata locally for a short time to save requests?
>
> Thank you very much for your time.
> <name / contact>

---

## 4. itch.io — OAuth integration for purchased asset packs (English)

To: itch.io support (https://itch.io/support — not verified during research)

> Subject: OAuth (profile:owned) for a game-making tool that tracks purchased asset licenses
>
> Hello itch.io team,
>
> I am developing "RPG System Studio (RPGシステム工房)" (【公開URL】), a free tool for making small 2D RPGs. Many of our users buy asset packs on itch.io, and I would like to help them keep correct license and credit records.
>
> Planned design: the user signs in with itch.io OAuth (authorization code + PKCE). The tool reads `profile:owned` to list the asset packs the user owns, and links to each pack's page so the user can read the license. The token is stored only on the user's own machine.
>
> Questions:
> 1. Is this use of OAuth and `profile:owned` acceptable for a third-party desktop/CLI tool?
> 2. Is there an approved way for such a tool to download the files of a pack the user owns (for example an uploads/download endpoint), or should users always download files in the browser themselves?
> 3. Is there anything in the Terms of Service we should observe about automated requests (rate limits, User-Agent, etc.)?
>
> Thank you!
> <name / contact>

---

### 問い合わせ不要と判断したもの（理由）
- Kenney / Google Fonts / Game-icons / OtoLogic / Incompetech: CC0・CC BY・OFL で条件が明確。リンク提示＋手動DLで足りる。
- 魔王魂 / 甘茶 / MusMus / ポケットサウンド / ぴぽや: 規約が明確な範囲（ゲーム組み込み可・素材単体の再配布不可）で、本ツールは自動アクセスしない設計にすれば問題が生じにくい。
- BOOTH / ココナラ / SKIMA / Unity: ログイン代行や購入履歴の自動取得はそもそも行わない（manual）方針にすれば問い合わせ不要。
- Skeb / YouTube オーディオライブラリ / RPGツクールRTP: 使わない（avoid）。
