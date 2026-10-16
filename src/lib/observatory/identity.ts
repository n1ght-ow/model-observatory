// Namespace removal is explicit. Versions, dates, fast/vision variants and unknown
// aliases survive; a vendor family is never a model identity.
const namespaces = new Set([
	"openai", "anthropic", "deepseek", "google", "gemini", "moonshotai", "moonshot",
	"z-ai", "zai", "meta", "meta-llama", "qwen", "commandcode", "command-code",
	"commandcode-messages", "opencode-free", "opencode-go", "opencode-free-responses",
	"custom", "ccs-apikey-fan", "ccs-deepseek",
]);

export function normalizeModel(raw: string, aliases: Record<string, string> = {}): string {
	let name = raw.trim().toLowerCase();
	while (name.includes("/") && namespaces.has(name.split("/")[0])) {
		name = name.slice(name.indexOf("/") + 1);
	}
	const rawKey = raw.trim().toLowerCase();
	return (Object.hasOwn(aliases, rawKey) ? aliases[rawKey] : Object.hasOwn(aliases, name) ? aliases[name] : name) || "unknown";
}

export function modelVendor(name: string): string {
	if (/^(gpt-|o[134]-|chatgpt)/.test(name)) return "OpenAI";
	if (name.startsWith("claude")) return "Anthropic";
	if (name.startsWith("deepseek")) return "DeepSeek";
	if (name.startsWith("glm")) return "Z.ai";
	if (name.startsWith("kimi")) return "Moonshot";
	if (name.startsWith("gemini")) return "Google";
	if (name.startsWith("qwen")) return "Qwen";
	return "其他模型";
}
