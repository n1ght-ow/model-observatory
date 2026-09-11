"use client";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";

export default function Error({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<div className="flex min-h-[60vh] items-center justify-center p-6">
			<Card className="max-w-md">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<AlertTriangleIcon data-icon="inline-start" />
						Failed to load the dashboard
					</CardTitle>
					<CardDescription>
						The active data source could not be read. Check the DeepSeek API
						or Codex Router configuration and try again.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					{error.message ? (
						<pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
							{error.message}
						</pre>
					) : null}
					<Button className="w-max" size="sm" onClick={reset}>
						<RefreshCwIcon data-icon="inline-start" />
						Try again
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
