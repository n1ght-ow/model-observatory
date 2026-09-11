import { AppShell } from "@/components/app-shell";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
	return (
		<AppShell>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div className="flex flex-col gap-2">
						<Skeleton className="h-6 w-32" />
						<Skeleton className="h-4 w-80 max-w-full" />
					</div>
					<Skeleton className="h-8 w-56" />
				</div>
				<DashboardSkeleton />
			</div>
		</AppShell>
	);
}
