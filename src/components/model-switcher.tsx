"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FilterIcon, RotateCcwIcon } from "lucide-react";
import type { ModelUsage } from "@/lib/metrics/types";
import { formatInteger } from "@/components/formater";

const ALL = "all";

/** Keep the label readable while the full model id stays the filter value. */
function shortModel(model: string): string {
	const parts = model.split("/");
	return parts.length > 1 ? parts.slice(1).join("/") : model;
}

type RouteOption = {
	value: string;
	label: string;
	requests: number;
	providers?: number;
};

function buildProviderOptions(routes: ModelUsage[]): RouteOption[] {
	const totals = new Map<string, number>();
	for (const route of routes) {
		totals.set(
			route.provider,
			(totals.get(route.provider) ?? 0) + route.requests
		);
	}
	return [...totals.entries()]
		.map(([provider, requests]) => ({ value: provider, label: provider, requests }))
		.sort(
			(a, b) =>
				b.requests - a.requests || a.label.localeCompare(b.label)
		);
}

function buildModelOptions(
	routes: ModelUsage[],
	provider: string | null
): RouteOption[] {
	const scoped = provider
		? routes.filter((route) => route.provider === provider)
		: routes;
	const totals = new Map<string, { requests: number; providers: Set<string> }>();
	for (const route of scoped) {
		const entry = totals.get(route.model) ?? {
			requests: 0,
			providers: new Set<string>(),
		};
		entry.requests += route.requests;
		entry.providers.add(route.provider);
		totals.set(route.model, entry);
	}
	return [...totals.entries()]
		.map(([model, entry]) => ({
			value: model,
			label: shortModel(model),
			requests: entry.requests,
			providers: entry.providers.size,
		}))
		.sort(
			(a, b) =>
				b.requests - a.requests || a.label.localeCompare(b.label)
		);
}

export function ModelSwitcher({ routes }: { routes: ModelUsage[] }) {
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();

	const providerOptions = useMemo(
		() => buildProviderOptions(routes),
		[routes]
	);
	const selectedProviderRaw = searchParams.get("provider");
	const provider = providerOptions.some(
		(option) => option.value === selectedProviderRaw
	)
		? selectedProviderRaw
		: null;

	const modelOptions = useMemo(
		() => buildModelOptions(routes, provider),
		[routes, provider]
	);
	const selectedModelRaw = searchParams.get("model");
	const model = modelOptions.some((option) => option.value === selectedModelRaw)
		? selectedModelRaw
		: null;

	function push(providerValue: string | null, modelValue: string | null) {
		const params = new URLSearchParams(searchParams.toString());
		if (providerValue) {
			params.set("provider", providerValue);
		} else {
			params.delete("provider");
		}
		if (modelValue) {
			params.set("model", modelValue);
		} else {
			params.delete("model");
		}
		const query = params.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	}

	function onProviderChange(value: string | null) {
		if (!value) {
			push(null, null);
			return;
		}
		const nextProvider = value === ALL ? null : value;
		const keepModel =
			model &&
			(nextProvider === null ||
				routes.some(
					(route) =>
						route.provider === nextProvider && route.model === model
				));
		push(nextProvider, keepModel ? model : null);
	}

	function onModelChange(value: string | null) {
		if (!value) {
			push(provider, null);
			return;
		}
		push(provider, value === ALL ? null : value);
	}

	const hasFilter = provider !== null || model !== null;
	const selectedProviderLabel =
		providerOptions.find((option) => option.value === provider)?.label ??
		"All APIs";
	const selectedModelLabel =
		modelOptions.find((option) => option.value === model)?.label ??
		"All models";

	return (
		<div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
				<div className="flex flex-col gap-1.5">
					<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<FilterIcon data-icon="inline-start" />
						API / provider
					</span>
					<Select value={provider ?? ALL} onValueChange={onProviderChange}>
						<SelectTrigger className="min-w-44 sm:min-w-56">
							<SelectValue>
								{() => (
									<span className="truncate">{selectedProviderLabel}</span>
								)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent className="max-h-80 min-w-60" align="start">
							<SelectGroup>
								<SelectItem value={ALL}>All APIs</SelectItem>
								{providerOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										<span className="truncate">{option.label}</span>
										<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
											{formatInteger(option.requests)}
										</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-1.5">
					<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<FilterIcon data-icon="inline-start" />
						Model
					</span>
					<Select value={model ?? ALL} onValueChange={onModelChange}>
						<SelectTrigger className="min-w-44 sm:min-w-64">
							<SelectValue>
								{() => (
									<span className="truncate">{selectedModelLabel}</span>
								)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent className="max-h-80 min-w-72" align="start">
							<SelectGroup>
								<SelectItem value={ALL}>
									<span className="truncate">All models</span>
									<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
										{formatInteger(modelOptions.reduce((sum, m) => sum + m.requests, 0))}
									</span>
								</SelectItem>
								{modelOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										<span className="truncate">{option.label}</span>
										<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
											{option.providers && option.providers > 1 && !provider
												? `${option.providers} APIs`
												: formatInteger(option.requests)}
										</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>
			</div>
			<Button
				className="w-max self-start md:self-end"
				disabled={!hasFilter}
				size="sm"
				variant="ghost"
				onClick={() => push(null, null)}
			>
				<RotateCcwIcon data-icon="inline-start" />
				Reset
			</Button>
		</div>
	);
}
