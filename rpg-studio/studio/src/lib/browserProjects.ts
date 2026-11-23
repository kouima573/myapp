/**
 * ブラウザ版の工房: プロジェクトをこのブラウザ（IndexedDB）に保存する。
 * 1件 = { id, title, texts（JSON・md・ts の中身）, files（追加・取り込んだ画像や音の中身）, updatedAt }。
 * 絵や音のうち見本から借りているものは保存せず、公開サイトに同梱の見本の素材を使う。
 */
export interface BrowserProject {
  id: string;
  title: string;
  /** "sample" = 見本から、"blank" = 新しいゲーム、"import" = ZIPから */
  origin: "sample" | "blank" | "import";
  texts: Record<string, string>;
  files: Record<string, Blob>;
  createdAt: string;
  updatedAt: string;
}

const DB = "rpg-studio-browser", STORE = "projects", CURRENT_KEY = "rpg-studio-browser-current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("このブラウザでは保存領域（IndexedDB）が使えません")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("保存領域を開けません"));
  });
}
async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? new Error("保存に失敗しました"));
      t.onabort = () => reject(t.error ?? new Error("保存が中断されました（空き容量が足りない可能性があります）"));
    });
  } finally { db.close(); }
}

export const listProjects = async (): Promise<BrowserProject[]> => ((await tx("readonly", s => s.getAll())) as BrowserProject[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
export const getProject = async (id: string): Promise<BrowserProject | undefined> => (await tx("readonly", s => s.get(id))) as BrowserProject | undefined;
export const putProject = async (p: BrowserProject): Promise<void> => { await tx("readwrite", s => s.put({ ...p, updatedAt: new Date().toISOString() })); };
export const deleteProject = async (id: string): Promise<void> => { await tx("readwrite", s => s.delete(id)); };

export function currentProjectId(): string | null { try { return localStorage.getItem(CURRENT_KEY); } catch { return null; } }
export function setCurrentProjectId(id: string | null) { try { if (id) localStorage.setItem(CURRENT_KEY, id); else localStorage.removeItem(CURRENT_KEY); } catch { /* private mode */ } }

/** A unique id like "my-game", "my-game-2" … */
export async function freeId(base: string): Promise<string> {
  const ids = new Set((await listProjects()).map(p => p.id));
  const clean = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "my-game";
  if (!ids.has(clean)) return clean;
  for (let i = 2; ; i++) if (!ids.has(`${clean}-${i}`)) return `${clean}-${i}`;
}

/** Asks the browser to keep the data (not to clear it when space runs low). Best effort. */
export async function askPersistent(): Promise<boolean> {
  try { return Boolean(await navigator.storage?.persist?.()); } catch { return false; }
}
