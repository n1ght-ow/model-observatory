"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Observatory } from "@/components/observatory/observatory";
import Loading from "../loading";

function Requests() {
	const params = useSearchParams();
	return <Observatory key={`${params.get("model") ?? ""}:${params.get("client") ?? ""}:${params.get("project") ?? ""}:${params.get("session") ?? ""}:${params.get("unknown") ?? ""}`} view="requests" initialModel={params.get("model") ?? ""} initialRange={params.get("range") ?? ""} initialFrom={params.get("from") ?? ""} initialTo={params.get("to") ?? ""} initialClient={params.get("client") ?? ""} initialProject={params.get("project") ?? ""} initialSession={params.get("session") ?? ""} initialUnknown={params.get("unknown") ?? ""} />;
}

export default function Page() {
	return <Suspense fallback={<Loading />}><Requests /></Suspense>;
}
