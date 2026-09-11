import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { CommandCodeDashboard } from "@/components/command-code-dashboard";
import { Button } from "@/components/ui/button";
import { getCommandCodeReport } from "@/lib/commandcode/client";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CommandCodePage() {
	const report = await getCommandCodeReport();

	return (
		<AppShell>
			<div className="flex flex-col gap-4">
				<header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div className="flex flex-col gap-1">
						<h1 className="font-heading text-xl font-semibold tracking-tight">
							Command Code
						</h1>
						<p className="text-sm text-muted-foreground">
							Account usage, credit balance, and the 5-hour, weekly and monthly
							limit windows.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							nativeButton={false}
							render={
								<a
									href="https://commandcode.ai/docs/resources/usage-limits"
									rel="noreferrer"
									target="_blank"
								/>
							}
							size="sm"
							variant="outline"
						>
							<ExternalLinkIcon data-icon="inline-start" />
							Docs
						</Button>
						<Button
							nativeButton={false}
							render={<a href="/api/command-code?fresh=1" />}
							size="sm"
							variant="outline"
						>
							<RefreshCwIcon data-icon="inline-start" />
							JSON
						</Button>
						<AutoRefresh />
					</div>
				</header>
				<CommandCodeDashboard report={report} />
			</div>
		</AppShell>
	);
}
