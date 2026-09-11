import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatCompactNumber, formatInteger } from "@/components/formater";
import { shortModel } from "@/lib/metrics/format";
import type { ModelUsage } from "@/lib/metrics/types";

export function ModelUsageTable({
	models,
	showProvider = false,
}: {
	models: ModelUsage[];
	showProvider?: boolean;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="ps-6">Model</TableHead>
					{showProvider ? <TableHead>API</TableHead> : null}
					<TableHead className="text-right tabular-nums">Requests</TableHead>
					<TableHead className="text-right tabular-nums">Tokens</TableHead>
					<TableHead className="text-right tabular-nums">Avg latency</TableHead>
					<TableHead className="pe-6 text-right">Errors</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{models.map((model) => (
					<TableRow
						className="h-12"
						key={`${model.provider}-${model.model}`}
					>
						<TableCell
							className="max-w-64 truncate ps-6 font-medium"
							title={model.model}
						>
							{shortModel(model.model)}
						</TableCell>
						{showProvider ? (
							<TableCell className="text-muted-foreground tabular-nums">
								{model.provider}
							</TableCell>
						) : null}
						<TableCell className="text-right tabular-nums">
							{formatInteger(model.requests)}
						</TableCell>
						<TableCell className="text-right tabular-nums">
							{formatCompactNumber(model.tokens)}
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{model.avgDurationMs > 0
								? `${formatInteger(model.avgDurationMs)} ms`
								: "—"}
						</TableCell>
						<TableCell className="pe-6 text-right">
							<Badge
								className="tabular-nums"
								variant={model.errorRate > 0 ? "destructive" : "outline"}
							>
								{model.errorRate.toFixed(1)}%
							</Badge>
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
