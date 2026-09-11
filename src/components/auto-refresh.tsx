"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCwIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 5000;

function relativeUpdatedLabel(updatedAt: number, now: number): string {
	const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
	if (seconds < 5) {
		return "updated just now";
	}
	if (seconds < 60) {
		return `updated ${seconds}s ago`;
	}
	const minutes = Math.round(seconds / 60);
	return `updated ${minutes}m ago`;
}

export function AutoRefresh() {
	const router = useRouter();
	const [updatedAt, setUpdatedAt] = useState(() => Date.now());
	const [now, setNow] = useState(() => Date.now());
	const [pending, setPending] = useState(false);
	const pendingRef = useRef(false);

	const refresh = useCallback(() => {
		if (pendingRef.current) {
			return;
		}
		pendingRef.current = true;
		setPending(true);
		router.refresh();
		setUpdatedAt(Date.now());
		window.setTimeout(() => {
			pendingRef.current = false;
			setPending(false);
		}, 700);
	}, [router]);

	useEffect(() => {
		const tick = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(tick);
	}, []);

	useEffect(() => {
		const poll = window.setInterval(() => {
			if (document.visibilityState === "visible") {
				refresh();
			}
		}, REFRESH_INTERVAL_MS);
		return () => window.clearInterval(poll);
	}, [refresh]);

	return (
		<div className="flex items-center gap-2">
			<span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
				{relativeUpdatedLabel(updatedAt, now)}
			</span>
			<Button
				aria-label="Refresh dashboard"
				disabled={pending}
				size="sm"
				variant="outline"
				onClick={refresh}
			>
				<RefreshCwIcon
					className={cn(pending && "animate-spin")}
					data-icon="inline-start"
				/>
				Refresh
			</Button>
		</div>
	);
}
