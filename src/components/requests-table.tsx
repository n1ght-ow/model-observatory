"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatCompactNumber, formatInteger } from "@/components/formater";
import type { RequestRecord } from "@/lib/metrics/types";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	DownloadIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

type SortKey = "at" | "model" | "provider" | "totalTokens" | "durationMs" | "status";
type SortDirection = "asc" | "desc";

function statusLabel(status: number): string {
	if (status >= 200 && status < 300) {
		return `${status} OK`;
	}
	if (status === 0) {
		return "cancelled";
	}
	return `${status} error`;
}

function statusVariant(status: number): "secondary" | "destructive" | "outline" {
	if (status >= 200 && status < 300) {
		return "secondary";
	}
	return status === 0 ? "outline" : "destructive";
}

function shortModel(model: string): string {
	const parts = model.split("/");
	return parts.length > 1 ? parts.slice(1).join("/") : model;
}

function csvValue(value: string | number): string {
	const text = String(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(rows: RequestRecord[]) {
	const header = [
		"time",
		"model",
		"provider",
		"status",
		"durationMs",
		"inputTokens",
		"outputTokens",
		"totalTokens",
	];
	const lines = rows.map((row) =>
		[
			row.at,
			row.model,
			row.provider,
			row.status,
			row.durationMs ?? 0,
			row.inputTokens ?? 0,
			row.outputTokens ?? 0,
			row.totalTokens,
		]
			.map(csvValue)
			.join(",")
	);
	const blob = new Blob([[header.join(","), ...lines].join("\n")], {
		type: "text/csv;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `router-requests-${new Date().toISOString().slice(0, 10)}.csv`;
	anchor.click();
	URL.revokeObjectURL(url);
}

function SortButton({
	label,
	sort,
	sortKey,
	sortDirection,
	onToggle,
}: {
	label: string;
	sort: SortKey;
	sortKey: SortKey;
	sortDirection: SortDirection;
	onToggle: (key: SortKey) => void;
}) {
	const active = sortKey === sort;
	return (
		<button
			className={cn(
				"inline-flex items-center gap-1 transition-colors hover:text-foreground",
				active && "text-foreground"
			)}
			onClick={() => onToggle(sort)}
			type="button"
		>
			{label}
			{active ? (
				sortDirection === "asc" ? (
					<ArrowUpIcon className="size-3" />
				) : (
					<ArrowDownIcon className="size-3" />
				)
			) : null}
		</button>
	);
}

export function RequestsTable({
	rows,
	compact = false,
	limit,
}: {
	rows: RequestRecord[];
	compact?: boolean;
	limit?: number;
}) {
	const [page, setPage] = useState(1);
	const [sortKey, setSortKey] = useState<SortKey>("at");
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
	const displayRows = useMemo(
		() => (compact ? rows.slice(0, limit ?? 12) : rows),
		[compact, limit, rows]
	);
	const sortedRows = useMemo(() => {
		const direction = sortDirection === "asc" ? 1 : -1;
		return [...displayRows].sort((a, b) => {
			const left = a[sortKey] ?? 0;
			const right = b[sortKey] ?? 0;
			if (typeof left === "number" && typeof right === "number") {
				return (left - right) * direction;
			}
			return String(left).localeCompare(String(right)) * direction;
		});
	}, [displayRows, sortDirection, sortKey]);
	const pageCount = useMemo(
		() => Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE)),
		[sortedRows.length]
	);
	const safePage = Math.min(page, pageCount);
	const start = (safePage - 1) * PAGE_SIZE;
	const visible = sortedRows.slice(start, start + PAGE_SIZE);

	function toggleSort(key: SortKey) {
		if (key === sortKey) {
			setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
		} else {
			setSortKey(key);
			setSortDirection(key === "at" ? "desc" : "asc");
		}
		setPage(1);
	}

	return (
		<div className="flex flex-col">
			{!compact ? (
				<div className="flex items-center justify-between gap-3 border-b px-4 py-2 md:px-6">
					<p className="text-xs text-muted-foreground">
						Click a column header to sort.{" "}
						{formatInteger(sortedRows.length)} rows available.
					</p>
					<Button
						size="sm"
						variant="outline"
						onClick={() => downloadCsv(sortedRows)}
					>
						<DownloadIcon data-icon="inline-start" />
						Export CSV
					</Button>
				</div>
			) : null}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="ps-6">
							<SortButton
								label="Time"
								onToggle={toggleSort}
								sort="at"
								sortDirection={sortDirection}
								sortKey={sortKey}
							/>
						</TableHead>
						<TableHead>
							<SortButton
								label="Model"
								onToggle={toggleSort}
								sort="model"
								sortDirection={sortDirection}
								sortKey={sortKey}
							/>
						</TableHead>
						<TableHead>
							<SortButton
								label="API"
								onToggle={toggleSort}
								sort="provider"
								sortDirection={sortDirection}
								sortKey={sortKey}
							/>
						</TableHead>
						<TableHead className="text-right">
							<span className="inline-flex justify-end">
								<SortButton
									label="Tokens"
									onToggle={toggleSort}
									sort="totalTokens"
									sortDirection={sortDirection}
									sortKey={sortKey}
								/>
							</span>
						</TableHead>
						<TableHead className="text-right">
							<span className="inline-flex justify-end">
								<SortButton
									label="Latency"
									onToggle={toggleSort}
									sort="durationMs"
									sortDirection={sortDirection}
									sortKey={sortKey}
								/>
							</span>
						</TableHead>
						<TableHead className="pe-6 text-right">
							<span className="inline-flex justify-end">
								<SortButton
									label="Status"
									onToggle={toggleSort}
									sort="status"
									sortDirection={sortDirection}
									sortKey={sortKey}
								/>
							</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{visible.map((row) => (
						<TableRow key={`${row.at}-${row.provider}-${row.model}`}>
							<TableCell className="ps-6 text-muted-foreground tabular-nums">
								{TIME_FORMATTER.format(new Date(row.at))}
							</TableCell>
							<TableCell
								className="max-w-64 truncate font-medium"
								title={row.model}
							>
								{shortModel(row.model)}
							</TableCell>
							<TableCell className="text-muted-foreground tabular-nums">
								{row.provider}
							</TableCell>
							<TableCell className="text-right">
								<span className="block font-medium tabular-nums">
									{formatCompactNumber(row.totalTokens)}
								</span>
								<span className="block text-xs text-muted-foreground tabular-nums">
									{formatInteger(row.inputTokens ?? 0)} in ·{" "}
									{formatInteger(row.outputTokens ?? 0)} out
									{row.costUsd
										? ` · $${row.costUsd.toFixed(4)}`
										: ""}
								</span>
							</TableCell>
							<TableCell className="text-right text-muted-foreground tabular-nums">
								{(row.durationMs ?? 0) > 0
									? `${formatInteger(row.durationMs ?? 0)} ms`
									: "—"}
							</TableCell>
							<TableCell className="pe-6 text-right">
								<Badge variant={statusVariant(row.status)}>
									{statusLabel(row.status)}
								</Badge>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			{!compact ? (
				<div className="flex items-center justify-between gap-3 border-t px-4 py-3 md:px-6">
					<p className="text-xs text-muted-foreground tabular-nums">
						{formatInteger(start + 1)}–{formatInteger(start + visible.length)} of{" "}
						{formatInteger(sortedRows.length)} requests
					</p>
					<div className="flex items-center gap-1">
						<Button
							aria-label="Previous page"
							disabled={safePage <= 1}
							size="icon-sm"
							variant="outline"
							onClick={() => setPage((value) => Math.max(1, value - 1))}
						>
							<ChevronLeftIcon />
						</Button>
						<span className="min-w-16 px-2 text-center text-xs text-muted-foreground tabular-nums">
							Page {safePage} / {pageCount}
						</span>
						<Button
							aria-label="Next page"
							disabled={safePage >= pageCount}
							size="icon-sm"
							variant="outline"
							onClick={() =>
								setPage((value) => Math.min(pageCount, value + 1))
							}
						>
							<ChevronRightIcon />
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
