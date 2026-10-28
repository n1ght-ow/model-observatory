"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Observatory } from "@/components/observatory/observatory";
import Loading from "../loading";

function Projects() {
	const params = useSearchParams();
	const project = params.get("project") ?? "";
	const session = params.get("session") ?? "";
	const sort = params.get("sort") === "tokens" ? "tokens" : params.get("sort") === "cost" ? "cost" : "requests";
	return <Observatory key={`${project}:${session}:${sort}`} view="projects" initialProject={project} initialSession={session} initialSort={sort} initialRange={params.get("range") ?? ""} initialFrom={params.get("from") ?? ""} initialTo={params.get("to") ?? ""} />;
}

export default function Page() {
	return <Suspense fallback={<Loading />}><Projects /></Suspense>;
}
