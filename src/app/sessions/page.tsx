"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Observatory } from "@/components/observatory/observatory";
import Loading from "../loading";

function Sessions() {
	const params = useSearchParams();
	const session = params.get("session") ?? "";
	const project = params.get("project") ?? "";
	const sort = params.get("sort") === "tokens" ? "tokens" : params.get("sort") === "cost" ? "cost" : "requests";
	return <Observatory key={`${session}:${project}:${sort}`} view="sessions" initialSession={session} initialProject={project} initialSort={sort} initialRange={params.get("range") ?? ""} initialFrom={params.get("from") ?? ""} initialTo={params.get("to") ?? ""} />;
}

export default function Page() {
	return <Suspense fallback={<Loading />}><Sessions /></Suspense>;
}
