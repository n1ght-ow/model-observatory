"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { beijingDate, DAY, validCustomDates, type CustomDates } from "@/lib/observatory/time-range";

const dateTime = (value: string) => Date.parse(`${value}T00:00:00Z`);
const isoDate = (value: number) => new Date(value).toISOString().split("T")[0];
const shiftDate = (value: string, days: number) => isoDate(dateTime(value) + days * DAY);
const isDate = (value: string) => validCustomDates({ from: value, to: value });
const dateLabel = (value: string) => `${Number(value.slice(0, 4))}年${Number(value.slice(5, 7))}月${Number(value.slice(8))}日`;

export function DateRangePicker({ anchor, dates, onApply, onClose }: { anchor: RefObject<HTMLButtonElement | null>; dates?: CustomDates; onApply: (dates: CustomDates) => void; onClose: () => void }) {
	const today = beijingDate();
	const [from, setFrom] = useState(dates?.from ?? `${today.slice(0, 7)}-01`);
	const [to, setTo] = useState(dates?.to ?? today);
	const [month, setMonth] = useState((dates?.from ?? today).slice(0, 7));
	const [endpoint, setEndpoint] = useState<"from" | "to">("from");
	const [hover, setHover] = useState("");
	const [focusedDate, setFocusedDate] = useState(dates?.from ?? today);
	const panel = useRef<HTMLFormElement>(null);
	useLayoutEffect(() => {
		const element = panel.current;
		if (!element) return;
		function position() {
			if (!element || !anchor.current) return;
			const rect = anchor.current.getBoundingClientRect();
			const width = Math.min(360, window.innerWidth - 24);
			element.style.width = `${width}px`;
			const height = element.getBoundingClientRect().height;
			element.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
			const below = rect.bottom + 8;
			const top = below + height <= window.innerHeight - 12 ? below : rect.top - height - 8 >= 12 ? rect.top - height - 8 : Math.max(12, window.innerHeight - height - 12);
			element.style.top = `${top}px`;
		}
		const outside = (event: PointerEvent) => { if (event.target instanceof Node && !element.contains(event.target) && !anchor.current?.contains(event.target)) onClose(); };
		const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
		element.showPopover();
		position();
		element.querySelector<HTMLButtonElement>('.obs-calendar-days [tabindex="0"]')?.focus({ preventScroll: true });
		document.addEventListener("pointerdown", outside);
		document.addEventListener("keydown", escape);
		window.addEventListener("resize", position);
		window.addEventListener("scroll", position, true);
		const observer = new ResizeObserver(position);
		observer.observe(element);
		return () => { observer.disconnect(); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
	}, [anchor, onClose]);
	const first = `${month}-01`, weekday = (new Date(dateTime(first)).getUTCDay() + 6) % 7;
	const last = new Date(dateTime(first) + 32 * DAY); last.setUTCDate(0);
	const days = Array.from({ length: Math.ceil((weekday + last.getUTCDate()) / 7) * 7 }, (_, index) => shiftDate(first, index - weekday));
	const reversed = Boolean(from && to && from > to);
	const preview = endpoint === "to" && isDate(from) && hover ? [from, hover].sort() : null;
	const start = preview?.[0] ?? from, end = preview?.[1] ?? to;
	const tabDate = days.includes(focusedDate) ? focusedDate : first;
	function changeMonth(delta: number) {
		const next = new Date(dateTime(first)); next.setUTCMonth(next.getUTCMonth() + delta);
		if (next.getUTCFullYear() >= 1 && next.getUTCFullYear() <= 9999) setMonth(isoDate(next.getTime()).slice(0, 7));
		setHover("");
	}
	function chooseDay(value: string) {
		if (endpoint === "from" || !isDate(from)) { setFrom(value); setTo(""); setEndpoint("to"); }
		else { const ordered = [from, value].sort(); setFrom(ordered[0]); setTo(ordered[1]); setEndpoint("from"); }
		setHover(""); setFocusedDate(value); setMonth(value.slice(0, 7));
	}
	function focusDay(value: string) {
		if (!isDate(value) || value.startsWith("0000")) return;
		setFocusedDate(value); setMonth(value.slice(0, 7));
		requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>(`[data-date="${value}"]`)?.focus({ preventScroll: true }));
	}
	return <form ref={panel} popover="manual" id="obs-custom-dates" className="obs-date-editor" role="dialog" aria-label="选择日期范围" onSubmit={(event) => { event.preventDefault(); if (validCustomDates({ from, to })) onApply({ from, to }); }}>
		<div className="obs-date-heading"><strong>选择日期范围</strong><button type="button" className="obs-icon-button" aria-label="关闭日期选择" onClick={onClose}><X size={16} /></button></div>
		<div className="obs-date-fields">
			{(["from", "to"] as const).map((key, index) => <div className="obs-date-field" key={key}>
				{index === 1 && <ArrowRight className="obs-date-separator" size={14} aria-hidden="true" />}
				<label htmlFor={`obs-date-${key}`}>{key === "from" ? "开始日期" : "结束日期"}</label>
				<input id={`obs-date-${key}`} type="text" placeholder="YYYY-MM-DD" autoComplete="off" spellCheck={false} maxLength={10} value={key === "from" ? from : to} className={cn(endpoint === key && "is-editing")} aria-describedby="obs-date-hint" aria-invalid={reversed || Boolean((key === "from" ? from : to) && !isDate(key === "from" ? from : to))} onFocus={() => { setEndpoint(key); const value = key === "from" ? from : to; if (isDate(value)) setMonth(value.slice(0, 7)); }} onChange={(event) => (key === "from" ? setFrom : setTo)(event.target.value.replaceAll("/", "-"))} onBlur={(event) => { if (isDate(event.target.value)) setMonth(event.target.value.slice(0, 7)); }} />
			</div>)}
		</div>
		<div className="obs-calendar-heading"><button type="button" className="obs-icon-button" aria-label="上个月" onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></button><div><input aria-label="年份" type="number" min="1" max="9999" value={Number(month.slice(0, 4))} onChange={(event) => { const year = Number(event.target.value); if (Number.isInteger(year) && year >= 1 && year <= 9999) setMonth(`${String(year).padStart(4, "0")}-${month.slice(5)}`); }} /><span>年</span><select aria-label="月份" value={Number(month.slice(5))} onChange={(event) => setMonth(`${month.slice(0, 4)}-${event.target.value.padStart(2, "0")}`)}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{index + 1} 月</option>)}</select></div><button type="button" className="obs-icon-button" aria-label="下个月" onClick={() => changeMonth(1)}><ChevronRight size={16} /></button></div>
		<div className="obs-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
		<div className="obs-calendar-days" role="group" aria-label="日期" onMouseLeave={() => setHover("")}>{days.map((day) => {
			const selected = Boolean(start && end && day >= start && day <= end);
			return <button type="button" key={day} data-date={day} disabled={!isDate(day) || day.startsWith("0000")} tabIndex={day === tabDate ? 0 : -1} aria-label={dateLabel(day)} aria-pressed={selected || day === start} aria-current={day === today ? "date" : undefined} className={cn(selected && "is-in-range", day === start && "is-start", day === end && "is-end", day.slice(0, 7) !== month && "is-outside", day === today && "is-today")} onMouseEnter={() => setHover(day)} onFocus={() => setFocusedDate(day)} onClick={() => chooseDay(day)} onKeyDown={(event) => {
				const offset: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -((new Date(dateTime(day)).getUTCDay() + 6) % 7), End: 6 - ((new Date(dateTime(day)).getUTCDay() + 6) % 7) };
				if (event.key in offset) { event.preventDefault(); focusDay(shiftDate(day, offset[event.key])); }
				if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); const next = new Date(dateTime(day)); next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + (event.key === "PageUp" ? -1 : 1)); focusDay(isoDate(next.getTime())); }
			}}><span>{Number(day.split("-").at(-1))}</span></button>;
		})}</div>
		<div className="obs-calendar-shortcuts"><span>{endpoint === "to" && !to ? "再选一天作为结束日期" : "点选起止日期，或直接输入"}</span><button type="button" className="obs-text-button" onClick={() => { setMonth(today.slice(0, 7)); setFocusedDate(today); }}>回到本月</button></div>
		<div className="obs-date-footer"><span id="obs-date-hint" role={reversed ? "alert" : undefined}>{reversed ? "开始日期不能晚于结束日期" : "北京时间 · 含起止当天"}</span><div><button type="button" className="obs-button" onClick={onClose}>取消</button><button type="submit" className="obs-button obs-date-apply" disabled={!validCustomDates({ from, to })}>应用</button></div></div>
	</form>;
}
