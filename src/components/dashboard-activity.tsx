import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DashboardCard } from "@/components/dashboard-card";
import {
	CircleCheckIcon,
	CircleAlertIcon,
	CircleSlashIcon,
} from "lucide-react";
import { formatCompactNumber } from "@/components/formater";
import type { MetricSourceId, MetricsSnapshot } from "@/lib/metrics/types";

function relativeTime(iso: string): string {
	const diffMs = Date.now() - Date.parse(iso);
	const minutes = Math.round(diffMs / 60000);
	if (minutes < 1) {
		return "just now";
	}
	if (minutes < 60) {
		return `${minutes} min ago`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return `${hours} h ago`;
	}
	return `${Math.round(hours / 24)} d ago`;
}

function shortModel(model: string): string {
	const parts = model.split("/");
	return parts.length > 1 ? parts.slice(1).join("/") : model;
}

function iconFor(status: number) {
	if (status >= 200 && status < 300) {
		return (
			<CircleCheckIcon
			/>
		);
	}
	if (status === 0) {
		return (
			<CircleSlashIcon
			/>
		);
	}
	return (
		<CircleAlertIcon
		/>
	);
}

export function DashboardActivity({
	snapshot,
	source,
}: {
	snapshot: MetricsSnapshot;
	source: MetricSourceId;
}) {
	const items = snapshot.recent.slice(0, 6);

	return (
		<DashboardCard className="gap-0 md:col-span-2">
			<CardHeader className="border-b">
				<CardTitle>Activity</CardTitle>
				<CardDescription>
					{source === "router"
						? "Newest calls in the Codex Router log."
						: source === "harness"
							? "Newest turns in the DeepSeek Harness session logs."
							: "Newest calls through the native DeepSeek API."}
				</CardDescription>
			</CardHeader>
			<CardContent className="px-0">
				<ul className="flex flex-col divide-y divide-border">
					{items.map((item) => (
						<li
							className="flex h-16 items-center gap-3 px-6"
							key={`${item.at}-${item.model}`}
						>
							<span
								aria-hidden="true"
								className="flex size-10 shrink-0 items-center justify-center [&_svg]:size-4"
							>
								{iconFor(item.status)}
							</span>
							<div className="min-w-0 flex-1 space-y-1">
								<p className="line-clamp-1 text-pretty text-foreground text-sm leading-snug">
									{shortModel(item.model)}
								</p>
								<p className="text-muted-foreground text-xs">
									{relativeTime(item.at)} · {item.provider} ·{" "}
									{formatCompactNumber(item.totalTokens)} tokens
								</p>
							</div>
						</li>
					))}
				</ul>
			</CardContent>
		</DashboardCard>
	);
}
