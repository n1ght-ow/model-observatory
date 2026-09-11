/**
 * One name per upstream, everywhere a provider is shown.
 *
 * The readers disagree about spelling because they are reading different files: the
 * router writes \`commandcode\`, DSH writes \`command-code\`, CC Switch rows are
 * labelled by the page that read them. The same upstream therefore appeared under
 * several names in one table, and — worse — two rows for the same model on the same
 * upstream never merged, because grouping is by \`provider::model\`.
 *
 * This is the one place that decides what an upstream is called.
 *
 * It deliberately maps only names that are unambiguous. \`custom\` is **not** here: the
 * Codex provider called \`custom\` points at api.apikey.fun, while the router's
 * \`custom\` is a routing target with no host evidence at all. A name-keyed table
 * cannot tell those apart, so callers that know their context pass the answer in.
 */

export const DEEPSEEK_LABEL = "DeepSeek";
export const COMMAND_CODE_LABEL = "Command Code";

/** Spelling variants that always mean the same upstream. */
const ALIASES = new Map<string, string>([
	["deepseek", DEEPSEEK_LABEL],
	["deepseek-official", DEEPSEEK_LABEL],
	["deepseek api", DEEPSEEK_LABEL],
	["deepseek api · harness", DEEPSEEK_LABEL],
	["commandcode", COMMAND_CODE_LABEL],
	["command-code", COMMAND_CODE_LABEL],
]);

/**
 * The display name for an upstream, or the raw name when it is not a known alias.
 *
 * Unknown names are returned unchanged rather than folded into an "other" bucket: a
 * bucket hides which upstream it was, and the point of this table is recognition.
 */
export function providerLabel(raw: string): string {
	if (!raw) {
		return raw;
	}
	const key = raw.trim().toLowerCase();
	return ALIASES.get(key) ?? raw;
}

/** Whether a name is one this module knows how to rewrite. */
export function isKnownProvider(raw: string): boolean {
	return ALIASES.has((raw ?? "").trim().toLowerCase());
}
