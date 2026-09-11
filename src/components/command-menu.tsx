"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
	ActivityIcon,
	ArrowRightIcon,
	CpuIcon,
	FileJsonIcon,
	GaugeIcon,
	LayoutGridIcon,
	MoonIcon,
	RefreshCwIcon,
	SearchIcon,
	SunIcon,
	TerminalIcon,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

type Command = {
	id: string;
	label: string;
	hint: string;
	keywords: string;
	icon: React.ReactNode;
	run: () => void;
};

const isEditableTarget = (target: EventTarget | null) => {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target.isContentEditable ||
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.tagName === "SELECT"
	);
};

export function CommandMenu() {
	const router = useRouter();
	const { theme, toggleTheme } = useTheme();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const close = useCallback(() => {
		setOpen(false);
		setQuery("");
		setActiveIndex(0);
	}, []);

	const go = useCallback(
		(href: string) => {
			close();
			router.push(href);
		},
		[close, router]
	);

	const commands = useMemo<Command[]>(() => {
		const items: Command[] = [
			{
				id: "overview",
				label: "Overview",
				hint: "Usage, latency and token trends",
				keywords: "overview home dashboard 总览",
				icon: <LayoutGridIcon />,
				run: () => go("/"),
			},
			{
				id: "requests",
				label: "Requests",
				hint: "Browse the live request log",
				keywords: "requests log calls 请求",
				icon: <ActivityIcon />,
				run: () => go("/requests"),
			},
			{
				id: "models",
				label: "Models",
				hint: "Compare APIs and models by tokens",
				keywords: "models api routes 模型",
				icon: <CpuIcon />,
				run: () => go("/models"),
			},
			{
				id: "command-code",
				label: "Command Code",
				hint: "Usage, credits and 5h/weekly/monthly limits",
				keywords: "command code usage limits credits 用量 额度 限额 5h 周 月",
				icon: <GaugeIcon />,
				run: () => go("/command-code"),
			},
			{
				id: "json",
				label: "Open JSON API",
				hint: "Raw snapshot for /api/router",
				keywords: "json api data 接口",
				icon: <FileJsonIcon />,
				run: () => go("/api/metrics"),
			},
			{
				id: "console",
				label: "Open Router console",
				hint: "127.0.0.1:4200",
				keywords: "console terminal router 控制台",
				icon: <TerminalIcon />,
				run: () => {
					close();
					window.open("http://127.0.0.1:4200", "_blank", "noreferrer");
				},
			},
			{
				id: "refresh",
				label: "Refresh dashboard",
				hint: "Reload the current view",
				keywords: "refresh reload 刷新",
				icon: <RefreshCwIcon />,
				run: () => {
					close();
					router.refresh();
				},
			},
			{
				id: "theme",
				label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
				hint: "Toggle appearance",
				keywords: "theme dark light 主题",
				icon: theme === "dark" ? <SunIcon /> : <MoonIcon />,
				run: () => {
					close();
					toggleTheme();
				},
			},
		];
		return items.filter((item) => !item.id.startsWith("range-"));
	}, [close, go, router, theme, toggleTheme]);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			return commands;
		}
		return commands.filter((command) =>
			`${command.label} ${command.hint} ${command.keywords}`
				.toLowerCase()
				.includes(needle)
		);
	}, [commands, query]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setOpen((current) => !current);
				return;
			}
			if (!open) {
				if (event.key === "/" && !isEditableTarget(event.target)) {
					event.preventDefault();
					setOpen(true);
				}
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				close();
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setActiveIndex((index) =>
					filtered.length === 0 ? 0 : (index + 1) % filtered.length
				);
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setActiveIndex((index) =>
					filtered.length === 0
						? 0
						: (index - 1 + filtered.length) % filtered.length
				);
			}
			if (event.key === "Enter") {
				event.preventDefault();
				filtered[activeIndex]?.run();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [activeIndex, close, filtered, open]);

	useEffect(() => {
		if (open) {
			window.requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	return (
		<>
			<button
				aria-label="Search and commands"
				className={cn(
					"hidden h-7 items-center gap-2 rounded-lg border border-border bg-background px-2 text-xs text-muted-foreground transition-colors md:inline-flex",
					"hover:bg-muted hover:text-foreground"
				)}
				onClick={() => setOpen(true)}
				type="button"
			>
				<SearchIcon className="size-3.5" />
				<span>Search</span>
				<KbdGroup>
					<Kbd>⌘</Kbd>
					<Kbd>K</Kbd>
				</KbdGroup>
			</button>
			<DialogPrimitive.Root open={open} onOpenChange={setOpen}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs" />
					<DialogPrimitive.Popup
						aria-label="Command menu"
						className="fixed top-[18%] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl outline-none transition data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0"
					>
						<DialogPrimitive.Title className="sr-only">
							Command menu
						</DialogPrimitive.Title>
						<div className="flex items-center gap-2 border-b px-3">
							<SearchIcon className="size-4 shrink-0 text-muted-foreground" />
							<Input
								ref={inputRef}
								aria-label="Search commands"
								className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
								placeholder="Search pages, models, actions…"
								value={query}
								onChange={(event) => {
									setQuery(event.target.value);
									setActiveIndex(0);
								}}
							/>
							<Kbd>Esc</Kbd>
						</div>
						<div className="max-h-80 overflow-y-auto p-1.5">
							{filtered.length > 0 ? (
								filtered.map((command, index) => (
									<button
										className={cn(
											"flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
											index === activeIndex
												? "bg-accent text-accent-foreground"
												: "text-foreground hover:bg-muted"
										)}
										key={command.id}
										onClick={command.run}
										onMouseEnter={() => setActiveIndex(index)}
										type="button"
									>
										<span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background [&_svg]:size-3.5">
											{command.icon}
										</span>
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate font-medium">
												{command.label}
											</span>
											<span className="truncate text-xs text-muted-foreground">
												{command.hint}
											</span>
										</span>
										<ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
									</button>
								))
							) : (
								<p className="px-3 py-8 text-center text-sm text-muted-foreground">
									No matching commands
								</p>
							)}
						</div>
					</DialogPrimitive.Popup>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		</>
	);
}
