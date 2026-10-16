"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Observatory } from "@/components/observatory/observatory";
import Loading from "../loading";

function Requests() {
	const params = useSearchParams();
	return <Observatory key={params.toString()} view="requests" initialModel={params.get("model") ?? ""} initialRange={params.get("range") ?? "today"} initialClient={params.get("client") ?? ""} />;
}

export default function Page() {
	return <Suspense fallback={<Loading />}><Requests /></Suspense>;
}
