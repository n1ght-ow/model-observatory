"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PinIcon, PinOffIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { usePathname } from "next/navigation";
import {
	announceReady,
	closePanel,
	isTray,
	onTrayMessage,
	setPinned,
	setStatus,
} from "@/lib/tray/bridge";

/** Route to the name the tooltip uses, so the icon says where the panel is. */
const ROUTE_LABELS: Record<string, string> = {
	"/": "Overview",
	"/requests": "Requests",
	"/models": "Models",
	"/deepseek": "DeepSeek",
	"/command-code": "Command Code",
};

/**
 * The bridge either exists for the life of the document or never does, so there is
 * nothing to listen to - but React starts on the server snapshot (false) and only
 * moves off it when the store says something changed. Subscribing has to notify once,
 * or this component stays invisible until some unrelated re-render happens to occur.
 * That is not hypothetical: it made the controls missing on /deepseek, which is
 * server-rendered and does not re-render on its own.
 */
function subscribeToBridge(onChange: () => void) {
	const frame = requestAnimationFrame(onChange);
	return () => cancelAnimationFrame(frame);
}

/** False on the server, so the server and the first client render agree. */
const notInTray = () => false;

/**
 * Controls that only mean anything inside the tray flyout: the flyout has no
 * window chrome, and it hides as soon as it loses focus unless it is pinned.
 * Renders nothing in a browser.
 */
export function TrayControls() {
	const inTray = useSyncExternalStore(subscribeToBridge, isTray, notInTray);
	const [pinned, setPinnedState] = useState(false);
	const pathname = usePathname();

	// The tray icon is visible whether or not the panel is, so telling it which page
	// the panel is on is worth more than it costs.
	useEffect(() => {
		if (!inTray) {
			return;
		}
		const label = ROUTE_LABELS[pathname] ?? pathname;
		setStatus(`Router Monitor — ${label}`);
	}, [inTray, pathname]);

	useEffect(() => {
		if (!inTray) {
			return;
		}
		const unsubscribe = onTrayMessage((message) => {
			if (message.type === "state") {
				setPinnedState(message.pinned);
			}
		});
		// Ask the tray what it thinks, now that the page can receive the answer.
		announceReady();
		return unsubscribe;
	}, [inTray]);

	if (!inTray) {
		return null;
	}

	const label = pinned ? "取消固定面板" : "固定面板";

	return (
		<>
			<Button
				aria-label={label}
				aria-pressed={pinned}
				data-tray-control="pin"
				onClick={() => {
					const next = !pinned;
					setPinnedState(next);
					setPinned(next);
				}}
				size="icon-sm"
				title={label}
				variant={pinned ? "secondary" : "ghost"}
			>
				{pinned ? <PinIcon /> : <PinOffIcon />}
			</Button>
			<Button
				aria-label="关闭面板"
				data-tray-control="close"
				onClick={() => closePanel()}
				size="icon-sm"
				title="关闭面板（Esc）"
				variant="ghost"
			>
				<XIcon />
			</Button>
			<Separator
				className="h-4 data-[orientation=vertical]:self-center"
				orientation="vertical"
			/>
		</>
	);
}
