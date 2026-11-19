import { useCallback, useEffect, useState } from "react";

import { isNight } from "@/lib/daylight";

/**
 * Lights on/off for guest pages. The page starts in the mode Santiniketan's
 * sun says (index.html sets data-daylight before first paint); a visitor's
 * choice holds for the visit, until the next sunrise or sunset.
 * The choice lives in sessionStorage as { mode, sun } and only counts while
 * the sun is still in the state it was chosen in.
 */
const KEY = "rk-lights";
type Mode = "day" | "night";

const current = (): Mode | null => {
  const v = typeof document === "undefined" ? null : document.documentElement.getAttribute("data-daylight");
  return v === "day" || v === "night" ? v : null;
};

function apply(mode: Mode) {
  document.documentElement.setAttribute("data-daylight", mode);
  window.dispatchEvent(new Event("rk-daylight"));
}

// A wall switch: a short bright snap over a soft low thump, made in Web Audio (no file to load).
let audio: AudioContext | null = null;
function click(on: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const t = audio.currentTime;
    const out = audio.createGain();
    out.gain.value = 0.35;
    out.connect(audio.destination);
    const len = Math.floor(audio.sampleRate * 0.03);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    const snap = audio.createBufferSource();
    const hp = audio.createBiquadFilter();
    snap.buffer = buf;
    hp.type = "highpass";
    hp.frequency.value = on ? 2200 : 1700;
    snap.connect(hp).connect(out);
    snap.start(t);
    const thump = audio.createOscillator();
    const tg = audio.createGain();
    thump.frequency.setValueAtTime(on ? 180 : 150, t);
    thump.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    tg.gain.setValueAtTime(0.5, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    thump.connect(tg).connect(out);
    thump.start(t);
    thump.stop(t + 0.07);
  } catch {
    /* no audio: the switch still works */
  }
}

export function LightsSwitch({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    if (current() === null) return; // admin and documents: no switch
    const sync = () => setMode(current());
    sync();
    window.addEventListener("rk-daylight", sync);
    // Sunrise and sunset still switch an open page, and clear the visitor's choice.
    let sun: Mode = isNight() ? "night" : "day";
    const timer = window.setInterval(() => {
      const now: Mode = isNight() ? "night" : "day";
      if (now === sun) return;
      sun = now;
      try { sessionStorage.removeItem(KEY); } catch { /* private mode */ }
      apply(now);
    }, 60_000);
    return () => {
      window.removeEventListener("rk-daylight", sync);
      window.clearInterval(timer);
    };
  }, []);

  const toggle = useCallback(() => {
    const next: Mode = current() === "night" ? "day" : "night";
    click(next === "night");
    apply(next);
    try { sessionStorage.setItem(KEY, JSON.stringify({ mode: next, sun: isNight() ? "night" : "day" })); } catch { /* private mode */ }
  }, []);

  if (mode === null) return null;
  const on = mode === "night";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={`flex shrink-0 items-center gap-2 rounded-full border border-border px-2.5 py-1.5 text-[12px] font-semibold text-primary transition-colors hover:border-primary ${className}`}
      data-testid="button-lights"
    >
      <span aria-hidden="true" className={`relative h-[18px] w-[30px] rounded-full transition-colors ${on ? "bg-accent/45" : "bg-muted"}`}>
        <span className={`absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full transition-transform duration-300 ${on ? "translate-x-[12px] bg-accent shadow-[0_0_10px_hsl(var(--accent))]" : "bg-primary/70"}`} />
      </span>
      {on ? "Lights off" : "Lights on"}
    </button>
  );
}
