import type { ReactNode } from "react";
import {
	LayoutGridIcon,
	ActivityIcon,
	CpuIcon,
	SparklesIcon,
	TerminalIcon,
	FileJsonIcon,
	GaugeIcon,
} from "lucide-react";

export type SidebarNavItem = {
	title: string;
	path?: string;
	icon?: ReactNode;
	isActive?: boolean;
	subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
	label?: string;
	items: SidebarNavItem[];
};

export const navGroups: SidebarNavGroup[] = [
	{
		label: "Router",
		items: [
			{
				title: "Overview",
				path: "/",
				icon: (
					<LayoutGridIcon
					/>
				),
			},
			{
				title: "Requests",
				path: "/requests",
				icon: (
					<ActivityIcon
					/>
				),
			},
			{
				title: "Models",
				path: "/models",
				icon: (
					<CpuIcon
					/>
				),
			},
			{
				title: "DeepSeek",
				path: "/deepseek",
				icon: (
					<SparklesIcon
					/>
				),
			},
			{
				title: "Command Code",
				path: "/command-code",
				icon: (
					<GaugeIcon
					/>
				),
			},
		],
	},
	{
		label: "Data",
		items: [
			{
				title: "JSON API",
				path: "/api/metrics",
				icon: (
					<FileJsonIcon
					/>
				),
			},
		],
	},
];

export const footerNavLinks: SidebarNavItem[] = [
	{
		title: "Router console",
		path: "http://127.0.0.1:4200",
		icon: (
			<TerminalIcon
			/>
		),
	},
];

export const navLinks: SidebarNavItem[] = [
	...navGroups.flatMap((group) =>
		group.items.flatMap((item) =>
			item.subItems?.length ? [item, ...item.subItems] : [item]
		)
	),
	...footerNavLinks,
];

/**
 * `Overview` (`/`) must match exactly; deeper routes only match when the
 * current path starts with the item path so pages stay highlighted while
 * query params (provider/model filters) change.
 */
export function isNavPathActive(
	pathname: string,
	path: string | undefined
): boolean {
	if (!path) {
		return false;
	}
	if (path === "/") {
		return pathname === "/";
	}
	return pathname === path || pathname.startsWith(`${path}/`);
}

export function findActiveNavItem(
	pathname: string,
	items: SidebarNavItem[] = navLinks
): SidebarNavItem | null {
	for (const item of items) {
		if (isNavPathActive(pathname, item.path)) {
			return item;
		}
		for (const subItem of item.subItems ?? []) {
			if (isNavPathActive(pathname, subItem.path)) {
				return subItem;
			}
		}
	}
	return null;
}
