"use client";

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
	isNavPathActive,
	type SidebarNavGroup,
} from "@/components/app-shared";
import { usePathname } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";

export function NavGroup({ label, items }: SidebarNavGroup) {
	const pathname = usePathname();
	return (
		<SidebarGroup>
			{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
			<SidebarMenu>
				{items.map((item) => {
					const isActive = isNavPathActive(pathname, item.path);
					return (
						<Collapsible
							className="group/collapsible"
							defaultOpen={true}
							key={item.title}
							render={<SidebarMenuItem />}
						>
							{item.subItems?.length ? (
								<>
									<CollapsibleTrigger
										render={<SidebarMenuButton isActive={isActive} />}
									>
										{item.icon}
										<span>{item.title}</span>
										<ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
									</CollapsibleTrigger>
									<CollapsibleContent>
										<SidebarMenuSub>
											{item.subItems?.map((subItem) => (
												<SidebarMenuSubItem key={subItem.title}>
													<SidebarMenuSubButton
														isActive={isNavPathActive(pathname, subItem.path)}
														render={<a href={subItem.path} />}
													>
														{subItem.icon}
														<span>{subItem.title}</span>
													</SidebarMenuSubButton>
												</SidebarMenuSubItem>
											))}
										</SidebarMenuSub>
									</CollapsibleContent>
								</>
							) : (
								<SidebarMenuButton
									isActive={isActive}
									render={<a href={item.path} />}
								>
									{item.icon}
									<span>{item.title}</span>
								</SidebarMenuButton>
							)}
						</Collapsible>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}
