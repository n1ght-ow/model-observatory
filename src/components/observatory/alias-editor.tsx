"use client";

import { useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";

export function AliasEditor({ aliases, names, onSaved }: { aliases: Record<string, string>; names: string[]; onSaved: () => void }) {
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	async function save(source: string, target: string) {
		setBusy(true);
		setMessage("");
		try {
			const response = await fetch("/api/observatory/aliases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: source, to: target }) });
			if (!response.ok) throw new Error("保存失败");
			setFrom("");
			setTo("");
			setMessage(target ? "规则已保存，统计将重新归组。" : "规则已移除，恢复日志名称。");
			onSaved();
		} catch { setMessage("规则保存失败，请重试。"); }
		finally { setBusy(false); }
	}
	return <section className="obs-alias-editor">
		<div className="obs-section-heading"><h2>模型命名规则</h2><span>只合并你已确认是同一个模型的名称</span></div>
		<p>路由别名与模型名称不一致时，可以在这里明确归组。规则只改变统计归属，保留原始记录。</p>
		<form onSubmit={(e) => { e.preventDefault(); save(from, to); }}>
			<label>日志中的名称<input list="observed-model-names" required maxLength={200} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="例如：某个路由别名" /></label>
			<ArrowRight size={17} />
			<label>统一模型名<input required maxLength={200} value={to} onChange={(e) => setTo(e.target.value)} placeholder="已确认的具体模型名称" /></label>
			<button className="obs-button" disabled={busy || !from.trim() || !to.trim()}><Check size={14} />{busy ? "保存中…" : "保存规则"}</button>
		</form>
		<datalist id="observed-model-names">{names.map((name) => <option key={name} value={name} />)}</datalist>
		<div className="obs-saved-aliases">{Object.entries(aliases).map(([source, target]) => <div key={source}><code>{source}</code><ArrowRight size={13} /><code>{target}</code><button className="obs-icon-button" disabled={busy} aria-label={`删除规则 ${source}`} onClick={() => save(source, "")}><X size={14} /></button></div>)}</div>
		{message && <p role="status">{message}</p>}
	</section>;
}
