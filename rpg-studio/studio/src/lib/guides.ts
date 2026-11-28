/**
 * 各画面の案内: この画面でできること・はじめての人へ・ほかのやり方（別の画面へ）。
 * 画面の上に1行で出し、「くわしく」で開く。閉じた画面は、このブラウザで覚えておく。
 */
export interface ScreenGuideData { what: string; first?: string[]; other?: Array<{ section: string; label: string }> }

export const GUIDES: Record<string, ScreenGuideData> = {
  tutorial: { what: "工房の使い方を5分で一周します。", first: ["上から順に進めると、マップに人を置いて話しかけるところまでできます"], other: [{ section: "chat", label: "チャットのAIと作る" }, { section: "idea", label: "思いつきを書き留める" }] },
  idea: { what: "作りたいゲームの思いつきを書き留める場所です（IDEA.md）。", first: ["うまく書かなくて大丈夫。「どんな場所で・誰が・何をする」を1行ずつ書いてみてください"], other: [{ section: "chat", label: "チャットのAIに相談して決める" }, { section: "tutorial", label: "まず工房を一周する" }] },
  chat: { what: "ChatGPT・Claude などに作業を頼む文を作り、返事を取り込みます。", first: ["短いRPGならチャットだけで作れます。長い作品は、作業用のAI（Codex など）や手元の工房がおすすめです"], other: [{ section: "idea", label: "思いつきを整理する" }] },
  help: { what: "困ったときの答え・用語の説明・完成までのチェックリストです。" },
  map: { what: "マップの地面や壁を塗り、人物・出入口・宝箱を置きます。", first: ["左のパレットでタイルを選び、マス目をクリック・ドラッグで塗ります", "人を置いたら、「会話・イベント」でセリフを書きます", "人物やマスを選んで「ここから試遊」を押すと、その場所から遊べます"], other: [{ section: "character", label: "タイルを作る（素材作り）" }, { section: "pixel", label: "タイルを自分で描く（ドット絵）" }, { section: "world", label: "マップのつながりを見る" }] },
  world: { what: "全部のマップと、そのつながり（出入口）を1枚で見ます。", other: [{ section: "map", label: "マップを編集する" }] },
  story: { what: "人物のセリフ・選択肢・イベント（宝箱を開ける、戦闘が始まる など）を書きます。", first: ["まずは1人に1つの会話から。分岐は「分岐図」で確かめられます"], other: [{ section: "chat", label: "AIにセリフの下書きを頼む" }, { section: "play", label: "試遊で話しかけてみる" }] },
  database: { what: "敵・アイテム・仲間・技などの数値と説明です。", first: ["数値に迷ったら見本の値をまねして、試遊で強さを確かめます"], other: [{ section: "character", label: "敵やキャラの絵を作る" }, { section: "play", label: "試遊で強さを確かめる" }] },
  rules: { what: "「〇〇したら△△になる」という決まり（フラグ・変数・特性）を作ります。", first: ["最初は使わなくても大丈夫。会話とイベントだけでもゲームは作れます"] },
  skills: { what: "六角形のパネルを開いて強くなる、成長の仕組みです。", first: ["なくてもゲームは作れます。成長の楽しさを足したいときに"] },
  scripts: { what: "TypeScript のコードで、データだけではできない動きを足します（上級）。", first: ["コードを書かなくてもゲームは作れます。必要になったときだけ"], other: [{ section: "chat", label: "AIにコードを頼む" }] },
  character: { what: "部品や色を選ぶだけで、キャラクター・顔グラフィック・敵・タイル・戦闘背景を作ります。", first: ["絵を描かなくても作れます。できた絵は、ゲームに使うのも、売ったり配ったりするのも自由です（内蔵ジェネレーター製）"], other: [{ section: "pixel", label: "作った絵を1ドットずつ直す" }, { section: "library", label: "用意された素材から選ぶ" }, { section: "assets", label: "手元の画像を取り込む" }] },
  pixel: { what: "1ドットずつ絵を描いたり、直したりします。", first: ["見本の絵（下絵）から描き直すのが近道です。左の「はじめての人へ」にコツがあります"], other: [{ section: "character", label: "部品を選ぶだけで作る" }] },
  song: { what: "ゲームの曲（BGM）と効果音です。", first: ["「おまかせ作曲」で場面を選ぶだけで曲ができます", "AIで作った曲や、素材サイトの曲も入れられます"], other: [{ section: "assets", label: "効果音の割り当て・素材の一覧" }] },
  library: { what: "工房が用意した素材（キャラ・タイル・敵など）から選んで入れます。", other: [{ section: "character", label: "部品を選んで自分で作る" }] },
  assets: { what: "このゲームの絵・音の一覧、取り込み、権利（売ってよいか）、素材パックの書き出しです。", first: ["「見本」の印が付いた素材は、見本のゲームから借りているものです"], other: [{ section: "checks", label: "販売前チェック" }] },
  play: { what: "作ったゲームを、その場で遊んで確かめます。", first: ["マップ画面で場所を選んで「ここから試遊」を押すと、好きな場所から始められます"], other: [{ section: "checks", label: "自動テスト・エラーの確認" }] },
  checks: { what: "データの誤り・自動テスト・販売前チェック・体験版・作品ページの材料です。", first: ["赤いエラーは、ゲームが動かない原因です。上から順に直してください"], other: [{ section: "help", label: "よくある失敗と直し方" }] },
  search: { what: "すべてのファイルから言葉を探して、まとめて置き換えます。" },
  data: { what: "ゲームのデータ（JSON）を、そのまま見たり直したりします（上級）。", first: ["ふだんは他の画面で直せます。困ったときや、AIの返事を貼るときに"] },
  history: { what: "保存の履歴です。前の状態に戻せます。" },
  projects: { what: "作品の切り替え・新しく作る・ZIPで保存・遊べる形での書き出しです。", first: ["ブラウザ版の作品は、このブラウザの中だけに保存されます。ときどき「プロジェクトをZIPで書き出す」で手元に残してください"], other: [{ section: "checks", label: "公開・販売の前のチェック" }] },
  experience: { what: "独立作品（RPGの形にしばられない作品）の設定と試遊です。" },
};

const KEY = "rpg-studio:guides-closed";
export function closedGuides(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]); } catch { return new Set(); } }
export function saveClosedGuides(set: Set<string>) { try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* optional */ } }
