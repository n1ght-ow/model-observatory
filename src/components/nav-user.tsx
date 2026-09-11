"use client";

import {
	Avatar,
	AvatarFallback,
} from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	TerminalIcon,
	FileJsonIcon,
	RefreshCwIcon,
	ServerIcon,
} from "lucide-react";

const endpoints = [
	{ label: "Router console", href: "http://127.0.0.1:4200", icon: TerminalIcon },
	{ label: "Router health", href: "http://127.0.0.1:4202/v1/health", icon: ServerIcon },
	{ label: "Usage JSON", href: "/api/metrics", icon: FileJsonIcon },
	{ label: "Reload data", href: "/", icon: RefreshCwIcon },
];

export function NavUser() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Avatar className="size-8" />}
				nativeButton={false}
			>
				<AvatarFallback>
					<ServerIcon />
				</AvatarFallback>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuItem className="flex items-center justify-start gap-2">
					<DropdownMenuLabel className="flex items-center gap-3">
						<Avatar className="size-10">
							<AvatarFallback>
								<ServerIcon />
							</AvatarFallback>
						</Avatar>
						<div>
							<span className="font-medium text-foreground">
								Codex Router
							</span>{" "}
							<br />
							<div className="max-w-full truncate text-muted-foreground text-xs">
								localhost:4202
							</div>
						</div>
					</DropdownMenuLabel>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					{endpoints.map((endpoint) => {
						const Icon = endpoint.icon;
						const external = endpoint.href.startsWith("http");
						return (
							<DropdownMenuItem
								key={endpoint.label}
								render={
									<a
										href={endpoint.href}
										rel={external ? "noreferrer" : undefined}
										target={external ? "_blank" : undefined}
									/>
								}
							>
								<Icon
								/>
								{endpoint.label}
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
