import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { storeDir } from "../lib/observatory/store";
import { normalizeModel } from "../lib/observatory/identity";
import { isLocalMutation } from "../lib/observatory/request-origin";

let writing: Promise<unknown> = Promise.resolve();

export async function POST(request: Request) {
	if (!isLocalMutation(request)) return Response.json({ error: "仅接受本地同源修改" }, { status: 403 });
	try {
		const raw = await request.text();
		if (Buffer.byteLength(raw) > 2048) throw new Error("规则过长");
		const body = JSON.parse(raw);
		if (typeof body.from !== "string" || !body.from.trim() || body.from.length > 200 || typeof body.to !== "string" || body.to.length > 200) throw new Error("请输入原始名称与归一名称");
		const from = body.from.trim().toLowerCase(), to = body.to.trim() ? normalizeModel(body.to) : "";
		const change = writing.catch(() => {}).then(async () => {
			let aliases: Record<string, string> = {};
			try {
				const parsed = JSON.parse(await readFile(join(storeDir, "aliases.json"), "utf8"));
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) aliases = parsed;
			} catch { /* First explicit naming rule or interrupted older write. */ }
			if (to && to !== from) aliases[from] = to; else delete aliases[from];
			await mkdir(storeDir, { recursive: true });
			const destination = join(storeDir, "aliases.json"), temporary = `${destination}.${process.pid}.tmp`;
			await writeFile(temporary, JSON.stringify(aliases, null, 2), "utf8");
			await rename(temporary, destination);
		});
		writing = change;
		await change;
		return Response.json({ saved: true });
	} catch { return Response.json({ error: "规则保存失败，请检查名称并重试" }, { status: 400 }); }
}
