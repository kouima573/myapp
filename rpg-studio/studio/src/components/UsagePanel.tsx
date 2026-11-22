import { useMemo } from "react";
import { Link2 } from "lucide-react";
import type { ProjectStore } from "../lib/useProject";

interface UsageReference { file: string; at: string; owner?: string; line?: string; code: boolean }

function segment(key: string): string {
  return /^[a-z_$][\w$]*$/i.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function findUsageReferences(texts: Record<string, string>, id: string): UsageReference[] {
  if (!id) return [];
  const found: UsageReference[] = [];
  for (const [file, text] of Object.entries(texts)) {
    if (file.endsWith(".json")) {
      let root: unknown;
      try { root = JSON.parse(text); } catch { continue; }
      const visit = (value: unknown, at: string, owner?: string) => {
        if (Array.isArray(value)) { value.forEach((child, index) => visit(child, `${at}[${index}]`, owner)); return; }
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        const ownId = typeof record.id === "string" ? record.id : undefined;
        const name = [record.name, record.label, record.speaker, record.title].find(item => typeof item === "string") as string | undefined;
        const nextOwner = ownId ? `${name ?? ownId}（${ownId}）` : owner;
        for (const [key, child] of Object.entries(record)) {
          const childPath = `${at}${segment(key)}`;
          // An object's own ID defines it. The panel lists references to that ID elsewhere.
          if (key !== "id" && child === id) found.push({ file, at: childPath, owner: nextOwner, code: false });
          else visit(child, childPath, nextOwner);
        }
      };
      visit(root, "$", undefined);
    } else if (file.endsWith(".ts")) {
      const quoted = JSON.stringify(id);
      text.split(/\r?\n/).forEach((line, index) => {
        if (line.includes(quoted) || line.includes(`'${id}'`)) found.push({ file, at: `行 ${index + 1}`, line: line.trim(), code: true });
      });
    }
  }
  const unique = new Map<string, UsageReference>();
  for (const ref of found) unique.set(`${ref.file}\0${ref.at}`, ref);
  return [...unique.values()].sort((a, b) => a.file.localeCompare(b.file) || a.at.localeCompare(b.at));
}

/** Live exact-ID references in project JSON and quoted script literals. */
export default function UsagePanel({ id, store, onOpenFile }: { id: string; store: ProjectStore; onOpenFile: (file: string) => void }) {
  const refs = useMemo(() => findUsageReferences(store.texts, id), [store.texts, id]);
  return <details className="usage-panel">
    <summary><Link2 size={13} /> 使用箇所 <span className="count">{refs.length}</span></summary>
    {refs.length === 0 ? <p className="muted small">IDが一致する参照はありません。</p> : <>
      <p className="muted small">プロジェクト内のJSONとスクリプトを検索しています。編集すると一覧も更新されます。</p>
      <ol className="usage-list">
        {refs.slice(0, 80).map(ref => <li key={`${ref.file}:${ref.at}`}>
          <button className="flow-link" onClick={() => onOpenFile(ref.file)}><code>{ref.file}</code></button>
          <div className="small">{ref.owner && <b>{ref.owner} · </b>}<code>{ref.at}</code></div>
          {ref.line && <div className="muted small usage-line">{ref.line}</div>}
        </li>)}
      </ol>
      {refs.length > 80 && <p className="muted small">ほか {refs.length - 80} 件</p>}
    </>}
  </details>;
}
