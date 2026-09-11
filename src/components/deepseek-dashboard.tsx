import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { DashboardCard } from "@/components/dashboard-card";
import { MetricStatGrid } from "@/components/metrics/metric-stat-grid";
import { ModelUsageTable } from "@/components/metrics/model-usage-table";
import { TrendChart } from "@/components/metrics/trend-chart";
import { formatInteger } from "@/components/formater";
import {
	DEEPSEEK_CURRENCY,
	DEEPSEEK_PRICING_SOURCE,
	DEEPSEEK_PRICING_UPDATED,
} from "@/lib/deepseek/cny-pricing";
import { formatMoney } from "@/lib/metrics/format";
import { formatDateTime } from "@/lib/metrics/time";
import type {
	DeepSeekAccount,
	MetricsSnapshot,
} from "@/lib/metrics/types";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CpuIcon,
	ExternalLinkIcon,
	RefreshCwIcon,
} from "lucide-react";

function periodLabel(snapshot: MetricsSnapshot): string {
	const { window } = snapshot;
	if (window.allTime) {
		return "all time";
	}
	if (window.days === 1) {
		return "last 24 hours";
	}
	return `last ${window.days} days`;
}

function AccountBadge({ account }: { account: DeepSeekAccount }) {
	if (!account.configured) {
		return (
			<Badge variant="outline">
				<CircleAlertIcon data-icon="inline-start" />
				not configured
			</Badge>
		);
	}
	if (!account.online) {
		return (
			<Badge variant="destructive">
				<CircleAlertIcon data-icon="inline-start" />
				unreachable
			</Badge>
		);
	}
	if (!account.isAvailable) {
		return (
			<Badge variant="destructive">
				<CircleAlertIcon data-icon="inline-start" />
				unavailable
			</Badge>
		);
	}
	return (
		<Badge variant="secondary">
			<CircleCheckIcon data-icon="inline-start" />
			available
		</Badge>
	);
}

export function DeepSeekDashboard({
	snapshot,
}: {
	snapshot: MetricsSnapshot;
}) {
	const account: DeepSeekAccount = snapshot.account ?? {
		configured: false,
		online: false,
		isAvailable: false,
		balances: [],
		checkedAt: snapshot.generatedAt,
		latencyMs: 0,
		error: "DeepSeek account data is unavailable.",
		keySource: null,
	};
	const { window: windowStats, daily, windowModels } = snapshot;
	const rangeLabel = periodLabel(snapshot);
	const windowCost = windowStats.totalCostCny ?? 0;
	const allTimeCost = snapshot.totals.totalCostCny ?? 0;
	const costPerRequest =
		windowStats.requests > 0 ? windowCost / windowStats.requests : 0;
	const costPerMillionTokens =
		windowStats.totalTokens > 0
			? (windowCost / windowStats.totalTokens) * 1_000_000
			: 0;
	const models = [...windowModels].sort(
		(a, b) => b.tokens - a.tokens || b.requests - a.requests
	);
	const credentialLabel =
		account.keySource === "env"
			? "DEEPSEEK_API_KEY (environment)"
			: account.keySource === "file"
				? "~/.codex/codex-router/deepseek-api-key.secret"
				: "not configured";

	return (
		<div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2 lg:grid-cols-4">
			<MetricStatGrid snapshot={snapshot} />

			<DashboardCard className="gap-0 md:col-span-2">
				<CardHeader className="border-b">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle className="text-base">DeepSeek API account</CardTitle>
						<AccountBadge account={account} />
					</div>
					<CardDescription>
						Official DeepSeek API at api.deepseek.com, checked through
						/user/balance.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 px-6 py-4">
					<div className="flex items-center justify-between gap-3">
						<span className="text-sm text-muted-foreground">Credential</span>
						<span
							className="max-w-[60%] truncate text-right text-sm font-medium"
							title={credentialLabel}
						>
							{credentialLabel}
						</span>
					</div>
					<div className="flex items-center justify-between gap-3">
						<span className="text-sm text-muted-foreground">
							Account available
						</span>
						<span className="text-sm font-medium">
							{account.isAvailable ? "Yes" : "No"}
						</span>
					</div>
					<div className="flex items-center justify-between gap-3">
						<span className="text-sm text-muted-foreground">
							Balance check
						</span>
						<span className="text-sm font-medium tabular-nums">
							{account.online ? `${formatInteger(account.latencyMs)} ms` : "—"}
						</span>
					</div>
					<div className="flex items-center justify-between gap-3">
						<span className="text-sm text-muted-foreground">Checked at</span>
						<span className="text-sm font-medium tabular-nums">
							{formatDateTime(account.checkedAt)}
						</span>
					</div>
					{account.error ? (
						<p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
							{account.error}
						</p>
					) : null}
				</CardContent>
				<CardFooter className="justify-between border-t text-xs text-muted-foreground">
					<span>
						Source: DeepSeek API · native api.deepseek.com
					</span>
					<Button
						nativeButton={false}
						render={
							<a
								href="https://platform.deepseek.com/usage"
								rel="noreferrer"
								target="_blank"
							/>
						}
						size="sm"
						variant="ghost"
					>
						<ExternalLinkIcon data-icon="inline-start" />
						Platform
					</Button>
				</CardFooter>
			</DashboardCard>

			<DashboardCard className="gap-0 md:col-span-2">
				<CardHeader className="border-b">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle className="text-base">Balance and spend</CardTitle>
						<Badge className="tabular-nums" variant="secondary">
							{account.balances.length}{" "}
							{account.balances.length === 1 ? "currency" : "currencies"}
						</Badge>
						<Badge className="tabular-nums" variant="outline">
							{rangeLabel}
						</Badge>
					</div>
					<CardDescription>
						Remaining balance from /user/balance next to what the native DeepSeek
						API cost. The API has no usage endpoint, so spend is estimated from the
						token counts at DeepSeek&apos;s official {DEEPSEEK_CURRENCY} prices
						(peak and off-peak), updated {DEEPSEEK_PRICING_UPDATED}.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4 px-6 py-4">
					{account.balances.length > 0 ? (
						account.balances.map((balance) => (
							<div className="rounded-lg border p-4" key={balance.currency}>
								<div className="flex items-baseline justify-between gap-3">
									<span className="text-sm text-muted-foreground">Remaining</span>
									<span className="font-semibold text-2xl tabular-nums">
										{formatMoney(balance.currency, balance.totalBalance)}
									</span>
								</div>
								<div className="mt-3 grid grid-cols-2 gap-3 text-xs">
									<div>
										<p className="text-muted-foreground">Granted</p>
										<p className="font-medium tabular-nums">
											{formatMoney(balance.currency, balance.grantedBalance)}
										</p>
									</div>
									<div>
										<p className="text-muted-foreground">Topped up</p>
										<p className="font-medium tabular-nums">
											{formatMoney(
												balance.currency,
												balance.toppedUpBalance
											)}
										</p>
									</div>
									<div>
										<p className="text-muted-foreground">
											Spent <span className="lowercase">{rangeLabel}</span>{" "}
											(est.)
										</p>
										<p className="font-medium tabular-nums">
											{formatMoney(DEEPSEEK_CURRENCY, windowCost)}
										</p>
									</div>
									<div>
										<p className="text-muted-foreground">
											Spent all-time (est.)
										</p>
										<p className="font-medium tabular-nums">
											{formatMoney(DEEPSEEK_CURRENCY, allTimeCost)}
										</p>
									</div>
								</div>
								<p className="mt-3 border-t pt-3 text-xs text-muted-foreground tabular-nums">
									{formatInteger(windowStats.requests)} requests ·{" "}
									{formatMoney(DEEPSEEK_CURRENCY, costPerRequest)} per request ·{" "}
									{formatMoney(DEEPSEEK_CURRENCY, costPerMillionTokens)} per 1M tokens
								</p>
							</div>
						))
					) : (
						<p className="text-sm text-muted-foreground">
							No balance data.{" "}
							{account.error ??
								"Check the DeepSeek credential and try again."}
						</p>
					)}
				</CardContent>
				<CardFooter className="justify-between border-t text-xs text-muted-foreground">
					<span>
						Checked {formatDateTime(account.checkedAt)} · spend est. from{" "}
						<a
							className="underline underline-offset-2 hover:text-foreground"
							href={DEEPSEEK_PRICING_SOURCE}
							rel="noreferrer"
							target="_blank"
						>
							DeepSeek {DEEPSEEK_CURRENCY} pricing
						</a>
					</span>
					<Button
						nativeButton={false}
						render={<a href="/api/metrics?source=deepseek" />}
						size="sm"
						variant="ghost"
					>
						<RefreshCwIcon data-icon="inline-start" />
						JSON
					</Button>
				</CardFooter>
			</DashboardCard>


			<DashboardCard className="gap-0 md:col-span-2">
				<CardHeader className="border-b">
					<CardTitle>Requests and tokens per day</CardTitle>
					<CardDescription>
						DeepSeek native API usage, {rangeLabel}. Bars are requests; the
						line is tokens.
					</CardDescription>
				</CardHeader>
				<CardContent className="px-4 py-4">
					<TrendChart daily={daily} days={windowStats.days} mode="combined" />
				</CardContent>
			</DashboardCard>

			<DashboardCard className="gap-0 md:col-span-2">
				<CardHeader className="border-b">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle>Models</CardTitle>
						<Badge className="tabular-nums" variant="secondary">
							{models.length} routes
						</Badge>
					</div>
					<CardDescription>
						DeepSeek models with usage in {rangeLabel}.
					</CardDescription>
				</CardHeader>
				<CardContent className="px-0">
					{models.length > 0 ? (
						<ModelUsageTable models={models} showProvider />
					) : (
						<Empty className="min-h-40 px-6">
							<EmptyMedia variant="icon">
								<CpuIcon />
							</EmptyMedia>
							<EmptyHeader>
								<EmptyTitle>No DeepSeek usage</EmptyTitle>
								<EmptyContent>
									<EmptyDescription>
										No DeepSeek calls were recorded in this range.
									</EmptyDescription>
								</EmptyContent>
							</EmptyHeader>
						</Empty>
					)}
				</CardContent>
			</DashboardCard>
		</div>
	);
}
