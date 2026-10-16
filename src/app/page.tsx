"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Observatory } from "@/components/observatory/observatory";
import Loading from "./loading";

function Models() {
	const params = useSearchParams();
	return <Observatory view="models" initialRange={params.get("range") ?? ""} />;
}

export default function Page() {
	return <Suspense fallback={<Loading />}><Models /></Suspense>;
}
