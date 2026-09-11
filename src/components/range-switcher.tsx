"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
	isOverviewRange,
	type OverviewRange,
} from "@/lib/overview-range";

const RANGE_OPTIONS: { value: OverviewRange; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "30", label: "30d" },
	{ value: "7", label: "7d" },
	{ value: "1", label: "24h" },
];

export function RangeSwitcher({ value }: { value: OverviewRange }) {
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();

	function onValueChange(nextValue: string[]) {
		const nextRange = nextValue[0];
		if (!isOverviewRange(nextRange) || nextRange === value) {
			return;
		}
		const params = new URLSearchParams(searchParams.toString());
		params.set("range", nextRange);
		router.push(`${pathname}?${params.toString()}`, { scroll: false });
	}

	return (
		<ToggleGroup
			aria-label="Overview time range"
			onValueChange={onValueChange}
			size="sm"
			spacing={1}
			value={[value]}
			variant="outline"
		>
			{RANGE_OPTIONS.map((option) => (
				<ToggleGroupItem
					aria-label={`Show ${option.label}`}
					key={option.value}
					value={option.value}
				>
					{option.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
