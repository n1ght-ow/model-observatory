"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { MetricSourceId } from "@/lib/metrics/types";

const SOURCES: { id: MetricSourceId; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "deepseek", label: "DeepSeek API" },
	{ id: "router", label: "Codex Router API" },
	{ id: "harness", label: "DeepSeek Harness" },
];

export function SourceSwitcher({ active }: { active: MetricSourceId }) {
	const pathname = usePathname();
	const searchParams = useSearchParams();

	function hrefFor(source: MetricSourceId): string {
		const params = new URLSearchParams(searchParams.toString());
		params.set("source", source);
		return `${pathname}?${params.toString()}`;
	}

	return (
		<div className="flex w-max items-center gap-1 rounded-lg border p-1">
			{SOURCES.map((source) => (
				<Button
					key={source.id}
					nativeButton={false}
					render={<Link href={hrefFor(source.id)} />}
					size="sm"
					variant={active === source.id ? "secondary" : "ghost"}
				>
					{source.label}
				</Button>
			))}
		</div>
	);
}
