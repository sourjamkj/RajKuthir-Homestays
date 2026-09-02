import { useMemo, useState } from "react";
import { addDays, eachDayOfInterval, format, parseISO } from "date-fns";
import { DayPicker, type DateRange } from "react-day-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Plus, Trash2 } from "lucide-react";
import "react-day-picker/dist/style.css";

type Source = "manual" | "direct" | "bookingCom" | "airbnb" | "makeMyTrip";

type CalendarEventDto = {
  id: string;
  source: Source;
  startDate: string;
  endDate: string;
  title: string | null;
  note?: string | null;
  editable: boolean;
};

const SOURCE_META: Record<
  Source,
  { label: string; dot: string; chip: string }
> = {
  manual: {
    label: "Host block",
    dot: "#5A3E2B",
    chip: "bg-[#5A3E2B] text-white",
  },
  direct: {
    label: "Direct",
    dot: "#7A8065",
    chip: "bg-[#7A8065] text-white",
  },
  bookingCom: {
    label: "Booking.com",
    dot: "#A65E45",
    chip: "bg-[#A65E45] text-white",
  },
  airbnb: {
    label: "Airbnb",
    dot: "#C15B4A",
    chip: "bg-[#C15B4A] text-white",
  },
  makeMyTrip: {
    label: "MakeMyTrip",
    dot: "#28382D",
    chip: "bg-[#28382D] text-white",
  },
};

const EVENTS_QUERY_KEY = ["/api/calendar/events"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/calendar${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `Calendar request failed (${response.status})`,
    );
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

function nightsOf(event: {
  startDate: string;
  endDate: string;
}): Date[] {
  const start = parseISO(event.startDate);
  const endExclusive = parseISO(event.endDate);
  if (endExclusive <= start) return [start];

  return eachDayOfInterval({
    start,
    end: addDays(endExclusive, -1),
  });
}

export function AdminCalendar() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<DateRange | undefined>();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: EVENTS_QUERY_KEY,
    queryFn: () => api<{ events: CalendarEventDto[] }>("/events"),
    staleTime: 30_000,
    refetchOnMount: "always",
  });
  const events = data?.events ?? [];

  const nightIndex = useMemo(() => {
    const index = new Map<string, CalendarEventDto>();
    for (const event of events) {
      for (const day of nightsOf(event)) {
        index.set(format(day, "yyyy-MM-dd"), event);
      }
    }
    return index;
  }, [events]);

  const modifiers = useMemo(() => {
    const bySource: Record<Source, Date[]> = {
      manual: [],
      direct: [],
      bookingCom: [],
      airbnb: [],
      makeMyTrip: [],
    };

    for (const [iso, event] of nightIndex) {
      bySource[event.source].push(parseISO(iso));
    }

    return bySource;
  }, [nightIndex]);

  const blockMutation = useMutation({
    mutationFn: (body: {
      startDate: string;
      endDate: string;
      title?: string;
    }) =>
      api<CalendarEventDto>("/block", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/public"] });
      setRange(undefined);
      setTitle("");
      setError(null);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const unblockMutation = useMutation({
    mutationFn: (id: string) => api<void>(`/block/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EVENTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/public"] });
      setError(null);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  function handleBlock() {
    if (!range?.from) return;

    const endExclusive = range.to
      ? addDays(range.to, 1)
      : addDays(range.from, 1);
    blockMutation.mutate({
      startDate: format(range.from, "yyyy-MM-dd"),
      endDate: format(endExclusive, "yyyy-MM-dd"),
      title: title.trim() || undefined,
    });
  }

  const upcoming = useMemo(
    () => [...events].sort((left, right) => left.startDate.localeCompare(right.startDate)),
    [events],
  );

  return (
    <div className="grid gap-8 md:grid-cols-[auto,1fr]">
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-journal text-xl text-primary">Owner calendar</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Select the nights to hold for a direct booking, family stay, or
          maintenance.
        </p>

        <DayPicker
          mode="range"
          selected={range}
          onSelect={setRange}
          numberOfMonths={2}
          weekStartsOn={1}
          modifiers={modifiers}
          modifiersStyles={{
            manual: { backgroundColor: SOURCE_META.manual.dot, color: "#fff" },
            direct: { backgroundColor: SOURCE_META.direct.dot, color: "#fff" },
            bookingCom: {
              backgroundColor: SOURCE_META.bookingCom.dot,
              color: "#fff",
            },
            airbnb: { backgroundColor: SOURCE_META.airbnb.dot, color: "#fff" },
            makeMyTrip: {
              backgroundColor: SOURCE_META.makeMyTrip.dot,
              color: "#fff",
            },
          }}
        />

        <div className="mt-3 flex flex-wrap gap-3">
          {(Object.keys(SOURCE_META) as Source[]).map((source) => (
            <span
              key={source}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: SOURCE_META[source].dot }}
              />
              {SOURCE_META[source].label}
            </span>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Optional label (e.g. Family stay)"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            maxLength={120}
          />
          <button
            type="button"
            disabled={!range?.from || blockMutation.isPending}
            onClick={handleBlock}
            className="flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-bold uppercase tracking-[.12em] text-primary-foreground disabled:opacity-50"
          >
            {blockMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Block selected dates
          </button>
          {error && <p className="text-xs text-[#A65E45]">{error}</p>}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-journal text-xl text-primary">Blocked & booked</h3>
        {isLoading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : upcoming.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing blocked yet. Your villa shows fully available.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {upcoming.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SOURCE_META[event.source].chip}`}
                    >
                      {SOURCE_META[event.source].label}
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {event.title ?? "Reserved"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {format(parseISO(event.startDate), "d MMM")} →{" "}
                    {format(parseISO(event.endDate), "d MMM yyyy")}
                  </p>
                </div>

                {event.editable ? (
                  <button
                    type="button"
                    onClick={() => unblockMutation.mutate(event.id)}
                    disabled={unblockMutation.isPending}
                    className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold text-[#A65E45] hover:bg-[#A65E45]/5 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Unblock
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" /> OTA
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}