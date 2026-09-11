export function formatInteger(value: number): string {
	return new Intl.NumberFormat("en-US", {
		maximumFractionDigits: 0,
	}).format(value);
}

export function formatCompactNumber(value: number): string {
	return new Intl.NumberFormat("en-US", {
		maximumFractionDigits: 2,
		notation: "compact",
	}).format(value);
}

export function formatPercent(value: number, fractionDigits = 1): string {
	return `${value.toFixed(fractionDigits)}%`;
}

export function formatLatency(value: number | null | undefined): string {
	return value && value > 0 ? `${formatInteger(value)} ms` : "—";
}

export function formatCostUsd(value: number | null | undefined): string {
	if (value === null || value === undefined || value <= 0) {
		return "—";
	}
	return new Intl.NumberFormat("en-US", {
		currency: "USD",
		maximumFractionDigits: 4,
		minimumFractionDigits: 2,
		style: "currency",
	}).format(value);
}

export function formatMoney(currency: string, value: number): string {
	try {
		return new Intl.NumberFormat("zh-CN", {
			currency,
			maximumFractionDigits: 2,
			minimumFractionDigits: 2,
			style: "currency",
		}).format(value);
	} catch {
		return `${value.toFixed(2)} ${currency}`;
	}
}

export function shortModel(model: string): string {
	const parts = model.split("/");
	return parts.length > 1 ? parts.slice(1).join("/") : model;
}
