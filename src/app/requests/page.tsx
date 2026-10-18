"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Observatory } from "@/components/observatory/observatory";
import Loading from "../loading";

function Requests() {
	const params = useSearchParams();
	return <Observatory key={`${params.get("model") ?? ""}:${params.get("client") ?? ""}`} view="requests" initialModel={params.get("model") ?? ""} initialRange={params.get("range") ?? ""} initialFrom={params.get("from") ?? ""} initialTo={params.get("to") ?? ""} initialClient={params.get("client") ?? ""} />;
}

export default function Page() {
	return <Suspense fallback={<Loading />}><Requests /></Suspense>;
}
