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
import { LimitProgress } from "@/components/command-code-usage";
import { formatCompactNumber, formatFullCurrency, formatInteger } from "@/components/formater";
import { formatDateTime } from "@/lib/metrics/time";
import type { CommandCodeReport } from "@/lib/commandcode/types";
import {
	ActivityIcon,
	CalendarClockIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDollarSignIcon,
	CoinsIcon,
	ExternalLinkIcon,
	GaugeIcon,
	KeyRoundIcon,
	MailIcon,
	RefreshCwIcon,
	UserIcon,
	WalletIcon,
} from "lucide-react";

const USAGE_DOCS_URL = "https://commandcode.ai/docs/resources/usage-limits";

function StatTile({
	label,
	value,
	footer,
	icon,
}: {
	label: string;
	value: string;
	footer: string;
	icon: React.ReactNode;
}) {
	return (
		<DashboardCard className="gap-0">
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle className="font-normal text-xs tracking-wide">
					{label}
				</CardTitle>
				<span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>
			</CardHeader>
			<CardContent>
				<p className="font-semibold text-2xl tabular-nums">{value}</p>
			</CardContent>
			<CardFooter className="gap-1 bg-background text-xs text-muted-foreground">
				{footer}
			</CardFooter>
		</DashboardCard>
	);
}

function DetailRow({
	label,
	value,
	title,
}: {
	label: string;
	value: string;
	title?: string;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-sm text-muted-foreground">{label}</span>
			<span
				className="max-w-[60%] truncate text-right text-sm font-medium tabular-nums"
				title={title ?? value}
			>
				{value}
			</span>
		</div>
	);
}

function StatusBadge({ report }: { report: CommandCodeReport }) {
	if (!report.configured) {
		return (
			<Badge variant="outline">
				<CircleAlertIcon data-icon="inline-start" />
				not configured
			</Badge>
		);
	}
	if (!report.online) {
		return (
			<Badge variant="destructive">
				<CircleAlertIcon data-icon="inline-start" />
				unreachable
			</Badge>
		);
	}
	return (
		<Badge variant="secondary">
			<CircleCheckIcon data-icon="inline-start" />
			live
		</Badge>
	);
}

export function CommandCodeDashboard({
	report,
	now,
}: {
	report: CommandCodeReport;
	/** Render-time clock, injected so the page and its tests agree on "now". */
	now?: number;
}) {
	const { account, usage, credits, subscription, windows } = report;

	if (!report.configured) {
		return (
			<DashboardCard className="gap-0">
				<CardContent className="py-6">
					<Empty className="min-h-40">
						<EmptyMedia variant="icon">
							<KeyRoundIcon />
						</EmptyMedia>
						<EmptyHeader>
							<EmptyTitle>Command Code is not configured</EmptyTitle>
							<EmptyContent>
								<EmptyDescription>
									{report.error ??
										"Add a Command Code API key to read usage and limits."}
								</EmptyDescription>
							</EmptyContent>
						</EmptyHeader>
					</Empty>
				</CardContent>
			</DashboardCard>
		);
	}

	const planLabel = subscription?.planId ?? "no active plan";
	const periodEnd = subscription?.currentPeriodEnd ?? null;

	return (
		<div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2 lg:grid-cols-4">
			<StatTile
				footer={`${formatInteger(usage?.failedCount ?? 0)} failed · ${formatInteger(usage?.completedCount ?? 0)} completed`}
				icon={<ActivityIcon />}
				label="Requests"
				value={formatInteger(usage?.totalCount ?? 0)}
			/>
			<StatTile
				footer="all-time success rate"
				icon={<GaugeIcon />}
				label="Success rate"
				value={`${(usage?.successRate ?? 0).toFixed(2)}%`}
			/>
			<StatTile
				footer="credits billed all-time"
				icon={<CircleDollarSignIcon />}
				label="Total spend"
				value={formatFullCurrency(usage?.totalCost ?? 0)}
			/>
			<StatTile
				footer={`${formatCompactNumber(usage?.totalTokensIn ?? 0)} in · ${formatCompactNumber(usage?.totalTokensOut ?? 0)} out`}
				icon={<CoinsIcon />}
				label="Tokens"
				value={formatCompactNumber(usage?.totalTokens ?? 0)}
			/>

			<DashboardCard className="gap-0 md:col-span-2">
				<CardHeader className="border-b">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle className="text-base">Credit windows</CardTitle>
						<Badge variant="outline" className="tabular-nums">
							{windows.length} windows
						</Badge>
						{report.limits.limited === false ? (
							<Badge variant="secondary">unlimited</Badge>
						) : null}
					</div>
					<CardDescription>
						Command Code paces billing with a rolling 5-hour window, a weekly
						window, and the monthly credit grant of the current billing cycle.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4 px-6 py-4">
					{windows.length > 0 ? (
						windows.map((windowLimit) => (
							<LimitProgress
								key={windowLimit.id}
								now={now}
								window={windowLimit}
							/>
						))
					) : (
						<p className="text-sm text-muted-foreground">
							No paced windows reported — extra credits are never limited.
						</p>
					)}
				</CardContent>
				<CardFooter className="justify-between text-xs text-muted-foreground">
					<span className="tabular-nums">
						Checked {formatDateTime(report.fetchedAt)}
						{report.latencyMs > 0 ? ` · ${report.latencyMs} ms` : ""}
					</span>
					<Button
						nativeButton={false}
						render={<a href={USAGE_DOCS_URL} rel="noreferrer" target="_blank" />}
						size="sm"
						variant="ghost"
					>
						<ExternalLinkIcon data-icon="inline-start" />
						How limits work
					</Button>
				</CardFooter>
			</DashboardCard>

			<DashboardCard className="gap-0 md:col-span-2">
				<CardHeader className="border-b">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle className="text-base">Credits</CardTitle>
						<Badge variant="secondary" className="tabular-nums">
							{planLabel}
						</Badge>
					</div>
					<CardDescription>
						Remaining credits returned by /alpha/billing/credits.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4 px-6 py-4">
					<div className="rounded-lg border p-4">
						<div className="flex items-baseline justify-between gap-3">
							<span className="text-sm text-muted-foreground">
								Remaining this cycle
							</span>
							<span className="font-semibold text-2xl tabular-nums">
								{formatFullCurrency(credits?.monthlyCredits ?? 0)}
							</span>
						</div>
						<div className="mt-3 grid grid-cols-2 gap-3 text-xs">
							<div>
								<p className="text-muted-foreground">Purchased</p>
								<p className="font-medium tabular-nums">
									{formatFullCurrency(credits?.purchasedCredits ?? 0)}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground">Free</p>
								<p className="font-medium tabular-nums">
									{formatFullCurrency(credits?.freeCredits ?? 0)}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground">Spent this cycle</p>
								<p className="font-medium tabular-nums">
									{formatFullCurrency(usage?.totalMonthlyCredits ?? 0)}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground">Credit threshold</p>
								<p className="font-medium tabular-nums">
									{formatFullCurrency(credits?.creditThreshold ?? 0)}
								</p>
							</div>
						</div>
					</div>
					{credits?.belowThreshold ? (
						<p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
							Balance is below the configured credit threshold.
						</p>
					) : null}
				</CardContent>
				<CardFooter className="justify-between text-xs text-muted-foreground">
					<span>
						{credits?.belowThreshold ? "below threshold" : "above threshold"}
						{periodEnd ? ` · cycle ends ${formatDateTime(periodEnd)}` : ""}
					</span>
					<Button
						nativeButton={false}
						render={<a href="/api/command-code" />}
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
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle className="text-base">Account</CardTitle>
						<StatusBadge report={report} />
					</div>
					<CardDescription>
						{report.baseUrl} · /alpha/whoami
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 px-6 py-4">
					<DetailRow
						label="Name"
						value={account?.name ?? "—"}
					/>
					<DetailRow label="Username" value={account?.userName ?? "—"} />
					<DetailRow label="Email" value={account?.email ?? "—"} />
					<DetailRow
						label="User id"
						value={account?.id ?? "—"}
					/>
					<DetailRow
						label="Credential"
						value={
							report.credential
								? `${report.credential.hint} (${report.credential.source})`
								: "not configured"
						}
					/>
					{report.error ? (
						<p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
							{report.error}
						</p>
					) : null}
				</CardContent>
				<CardFooter className="justify-between text-xs text-muted-foreground">
					<span className="tabular-nums">
						Checked {formatDateTime(report.fetchedAt)}
					</span>
					<span className="flex items-center gap-1">
						<UserIcon className="size-3" />
						<MailIcon className="size-3" />
						<WalletIcon className="size-3" />
					</span>
				</CardFooter>
			</DashboardCard>

			<DashboardCard className="gap-0 md:col-span-2">
				<CardHeader className="border-b">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle className="text-base">Subscription</CardTitle>
						<Badge
							variant={
								subscription?.status === "active" ? "secondary" : "outline"
							}
						>
							{subscription?.status ?? "unknown"}
						</Badge>
					</div>
					<CardDescription>
						Billing cycle returned by /alpha/billing/subscriptions.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 px-6 py-4">
					<DetailRow label="Plan" value={subscription?.planId ?? "—"} />
					<DetailRow
						label="Cycle start"
						value={
							subscription?.currentPeriodStart
								? formatDateTime(subscription.currentPeriodStart)
								: "—"
						}
					/>
					<DetailRow
						label="Cycle end"
						value={
							subscription?.currentPeriodEnd
								? formatDateTime(subscription.currentPeriodEnd)
								: "—"
						}
					/>
					<DetailRow
						label="Renews"
						value={
							subscription?.cancelAtPeriodEnd ? "cancels at period end" : "auto"
						}
					/>
					<DetailRow
						label="Seats"
						value={formatInteger(subscription?.quantity ?? 0)}
					/>
				</CardContent>
				<CardFooter className="justify-between text-xs text-muted-foreground">
					<span className="flex items-center gap-1 tabular-nums">
						<CalendarClockIcon className="size-3" />
						{subscription?.id ?? "no subscription id"}
					</span>
				</CardFooter>
			</DashboardCard>

			<DashboardCard className="gap-0 lg:col-span-4">
				<CardHeader className="border-b">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle className="text-base">Endpoint health</CardTitle>
						<Badge variant="outline" className="tabular-nums">
							{report.failures.length} failed
						</Badge>
					</div>
					<CardDescription>
						The four Command Code API endpoints backing this page.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 px-6 py-4 sm:grid-cols-2 lg:grid-cols-4">
					{[
						{ path: "/alpha/whoami", ok: account !== null },
						{ path: "/alpha/usage/summary", ok: usage !== null },
						{ path: "/alpha/billing/credits", ok: credits !== null },
						{ path: "/alpha/billing/subscriptions", ok: subscription !== null },
					].map((endpoint) => {
						const failure = report.failures.find(
							(item) => item.endpoint === endpoint.path
						);
						return (
							<div className="rounded-lg border p-3" key={endpoint.path}>
								<div className="flex items-center gap-2">
									{failure ? (
										<CircleAlertIcon className="size-3.5 text-destructive" />
									) : (
										<CircleCheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
									)}
									<span className="truncate font-mono text-xs">
										{endpoint.path}
									</span>
								</div>
								<p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
									{failure ? failure.error : "ok"}
								</p>
							</div>
						);
					})}
				</CardContent>
			</DashboardCard>
		</div>
	);
}
