import { useEffect, useRef, useState } from "react";

import { asset } from "@/lib/site";
import { sunsetLine } from "@/lib/daylight";

/**
 * The homepage cover: the same frame of the villa by day and by night,
 * cross-faded by html[data-daylight] (set before first paint, flipped by the
 * Lights switch), so the server render and the first paint already agree.
 * A soft "lantern" under the cursor or finger shows the other light.
 * The day photo is the LCP the server preloads (seo.ts); the night one loads eagerly
 * at normal priority, so only one image competes for the first bytes.
 */
const DAY = asset("hero-day-v3.jpg");
const NIGHT = asset("hero-night-v3.jpg");
const ALT = "Raj Kuthir Homestays, Sobuj Potro, a private villa in Bolpur, Shantiniketan";

export function HeroPhotos() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    const stage = layer?.parentElement;
    if (!layer || !stage) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let tx = 0, ty = 0, sx = 0, sy = 0, seeded = false, raf = 0, off = 0;
    const loop = () => {
      const k = reduce ? 1 : 0.12;
      sx += (tx - sx) * k;
      sy += (ty - sy) * k;
      layer.style.setProperty("--x", `${sx.toFixed(1)}px`);
      layer.style.setProperty("--y", `${sy.toFixed(1)}px`);
      raf = Math.abs(tx - sx) > 0.1 || Math.abs(ty - sy) > 0.1 ? requestAnimationFrame(loop) : 0;
    };
    const aim = (x: number, y: number) => {
      const r = stage.getBoundingClientRect();
      tx = x - r.left;
      ty = y - r.top;
      if (!seeded) { sx = tx; sy = ty; seeded = true; }
      layer.classList.add("is-lit");
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const hide = () => layer.classList.remove("is-lit");
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const move = (e: PointerEvent) => aim(e.clientX, e.clientY);
    const touch = (e: TouchEvent) => { const t = e.touches[0]; if (t) { clearTimeout(off); aim(t.clientX, t.clientY); } };
    const start = (e: TouchEvent) => { seeded = false; touch(e); };
    const end = () => { off = window.setTimeout(hide, 700); };
    if (fine) {
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerleave", hide);
    } else {
      // Passive: the lantern follows the finger and scrolling still works.
      stage.addEventListener("touchstart", start, { passive: true });
      stage.addEventListener("touchmove", touch, { passive: true });
      stage.addEventListener("touchend", end, { passive: true });
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(off);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerleave", hide);
      stage.removeEventListener("touchstart", start);
      stage.removeEventListener("touchmove", touch);
      stage.removeEventListener("touchend", end);
    };
  }, []);

  const img = "absolute inset-0 h-full w-full object-cover object-[50%_46%] max-md:object-center";
  return (
    <div ref={ref} className="hero-lights absolute inset-0">
      <img src={DAY} alt={ALT} width={1536} height={928} loading="eager" fetchPriority="high" decoding="async" className={`hero-photo hero-photo--day ${img}`} />
      <img src={NIGHT} alt="" aria-hidden="true" width={1536} height={928} loading="eager" decoding="async" className={`hero-photo hero-photo--night ${img}`} />
      <img src={NIGHT} alt="" aria-hidden="true" width={1536} height={928} decoding="async" className={`hero-lantern hero-lantern--night ${img}`} />
      <img src={DAY} alt="" aria-hidden="true" width={1536} height={928} decoding="async" className={`hero-lantern hero-lantern--day ${img}`} />
    </div>
  );
}

export function SunsetLine({ className = "" }: { className?: string }) {
  // Filled after mount: the prerendered page has no clock to agree with.
  const [line, setLine] = useState("Santiniketan · West Bengal");
  useEffect(() => {
    const tick = () => setLine(sunsetLine());
    tick();
    const t = window.setInterval(tick, 30_000);
    return () => window.clearInterval(t);
  }, []);
  return <p className={className} aria-live="off">{line}</p>;
}
