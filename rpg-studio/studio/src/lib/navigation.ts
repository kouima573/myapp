/**
 * 工房の画面の並び: まとまり（はじめる・世界と物語・遊びの仕組み・絵と音・試す・公開）と、
 * 言葉で画面や機能を探す「画面さがし」の索引（「BGM」→音楽、「体験版」→検証 など）。
 */
export const SECTION_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "はじめる", ids: ["tutorial", "idea", "chat", "help"] },
  { label: "世界と物語", ids: ["map", "world", "story"] },
  { label: "遊びの仕組み", ids: ["database", "rules", "skills", "scripts"] },
  { label: "絵と音", ids: ["character", "pixel", "song", "library", "assets"] },
  { label: "試す・直す", ids: ["play", "checks", "search", "data", "history"] },
  { label: "保存・公開・販売", ids: ["projects", "experience"] },
];

/** Extra words for each screen (what people call the thing they are looking for). */
export const SECTION_WORDS: Record<string, string[]> = {
  tutorial: ["はじめて", "使い方", "入門", "チュートリアル", "最初"],
  idea: ["アイデア", "企画", "思いつき", "メモ", "IDEA"],
  chat: ["ChatGPT", "Claude", "AI", "相談", "チャット", "依頼"],
  help: ["ヘルプ", "困った", "わからない", "完成", "チェックリスト", "用語", "よくある失敗"],
  map: ["地図", "部屋", "町", "村", "ダンジョン", "タイル", "床", "壁", "人物", "NPC", "出入口", "宝箱"],
  world: ["全体図", "つながり", "マップ一覧"],
  story: ["会話", "セリフ", "台詞", "イベント", "選択肢", "分岐", "シナリオ", "台本"],
  database: ["アイテム", "武器", "防具", "装備", "敵", "モンスター", "仲間", "ステータス", "お店", "技", "魔法"],
  rules: ["ルール", "特性", "条件", "フラグ", "変数", "種族"],
  skills: ["スキル", "成長", "パネル", "レベル"],
  scripts: ["コード", "TypeScript", "プログラム", "スクリプト", "独自"],
  character: ["キャラ", "キャラクター", "顔", "顔グラ", "立ち絵", "敵の絵", "モンスターの絵", "タイル作り", "背景", "戦闘背景", "素材作り"],
  pixel: ["絵", "ドット", "ドット絵", "お絵かき", "描く", "画像", "色替え", "アニメ"],
  song: ["音楽", "BGM", "曲", "効果音", "作曲", "おまかせ作曲", "音楽AI", "Suno", "SOUNDRAW", "WAV", "楽譜", "サウンド"],
  library: ["ライブラリ", "内蔵素材", "共有素材"],
  assets: ["素材", "取り込み", "インポート", "クレジット", "ライセンス", "権利", "素材パック", "容量"],
  play: ["試遊", "テストプレイ", "遊ぶ", "動かす", "プレイ"],
  checks: ["検証", "エラー", "テスト", "販売前チェック", "体験版", "作品ページ", "スクリーンショット", "カバー"],
  search: ["検索", "置換", "探す", "一括"],
  data: ["JSON", "データ", "ファイル", "生データ"],
  history: ["履歴", "戻す", "復元", "保存履歴"],
  projects: ["保存", "書き出し", "ZIP", "公開", "itch", "新しく作る", "プロジェクト", "切り替え", "読み込み"],
  experience: ["独立作品", "ミニゲーム", "自由な形"],
};

/** Features inside screens (so "体験版" finds the screen it lives in). */
export const FEATURES: Array<{ label: string; section: string; words: string[] }> = [
  { label: "販売前チェック", section: "checks", words: ["販売", "売る", "公開前", "権利"] },
  { label: "体験版を作る", section: "checks", words: ["体験版", "デモ", "無料版"] },
  { label: "作品ページの材料（カバー画像・スクリーンショット・紹介文）", section: "checks", words: ["作品ページ", "カバー", "スクショ", "スクリーンショット", "紹介文", "itch", "BOOTH"] },
  { label: "素材パックとして書き出す（素材だけを配る・売る）", section: "assets", words: ["素材パック", "素材だけ", "配布", "販売"] },
  { label: "素材ファイルを取り込む（画像・音・フォント）", section: "assets", words: ["取り込み", "インポート", "PNG", "MP3", "OGG", "フォント"] },
  { label: "おまかせ作曲（場面を選ぶだけ）", section: "song", words: ["作曲", "BGM", "曲", "おまかせ"] },
  { label: "音楽AIで作る（リンクと注文文）", section: "song", words: ["音楽AI", "AI作曲", "Suno", "SOUNDRAW", "AIVA"] },
  { label: "曲をWAVで書き出す", section: "song", words: ["WAV", "書き出し", "音声ファイル"] },
  { label: "キャラクター・顔グラフィックを作る", section: "character", words: ["キャラ", "顔", "立ち絵", "主人公"] },
  { label: "敵・モンスターを作る", section: "character", words: ["敵", "モンスター"] },
  { label: "タイル集を作る", section: "character", words: ["タイル", "床", "壁", "地面"] },
  { label: "戦闘背景を作る", section: "character", words: ["背景", "戦闘背景"] },
  { label: "ゲームZIP（遊べる形）を作る", section: "projects", words: ["ゲームZIP", "公開", "遊べる形", "書き出し"] },
  { label: "プロジェクトをZIPで保存する", section: "projects", words: ["バックアップ", "保存", "ZIP"] },
  { label: "自動テストを録画する", section: "play", words: ["録画", "テスト", "シナリオ"] },
  { label: "マップを Tiled 形式・画像で書き出す", section: "assets", words: ["Tiled", "マップ画像", "tmj"] },
];

export interface NavHit { section: string; label: string; detail?: string }

/** Screens and features matching the words (all words must match somewhere). */
export function searchNav(query: string, sections: Array<{ id: string; label: string }>): NavHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const visible = new Set(sections.map(s => s.id));
  const match = (text: string) => words.every(w => text.toLowerCase().includes(w));
  const hits: NavHit[] = [];
  for (const s of sections) if (match([s.label, ...(SECTION_WORDS[s.id] ?? [])].join(" "))) hits.push({ section: s.id, label: s.label });
  for (const f of FEATURES) if (visible.has(f.section) && match([f.label, ...f.words].join(" "))) {
    hits.push({ section: f.section, label: f.label, detail: `${sections.find(s => s.id === f.section)?.label ?? f.section}の画面` });
  }
  return hits.slice(0, 12);
}
