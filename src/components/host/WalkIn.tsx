"use client";

import { useMemo, useState } from "react";
import { Hand, ListPlus } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/utils";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { clock, minsUntil, type Floor, type FloorTable } from "@/components/floor/types";
import { btn, fieldCls, Stepper, tableFit } from "./shared";

/**
 * A family at the door. Tap how many, tap a table: seated. If nothing is
 * free, they go on the waiting list with an honest wait, in the same place.
 */
export function WalkInDialog({
  floor,
  now,
  onClose,
  onDone,
  onPickOnFloor,
}: {
  floor: Floor;
  now: number;
  onClose: () => void;
  onDone: (msg: string) => void;
  onPickOnFloor: (party: number) => void;
}) {
  const [party, setParty] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<{ msg: string; table: FloorTable } | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const options = useMemo(() => {
    if (!party) return [];
    const p = { kind: "walkin" as const, party };
    return (
      floor.tables
        .map((t) => ({ t, fit: tableFit(t, p) }))
        .filter((x) => x.fit === "fits" || x.fit === "soon")
        // A family table isn't offered to two while smaller tables are free.
        .filter((x, _i, all) => x.t.minParty <= party || all.every((y) => y.t.minParty > party))
        .sort(
          (a, b) =>
            (a.fit === "fits" ? 0 : 1) - (b.fit === "fits" ? 0 : 1) ||
            a.t.seats - b.t.seats ||
            // A table with a booking soon is a worse choice.
            (a.t.next ? 1 : 0) - (b.t.next ? 1 : 0),
        )
        .slice(0, 6)
    );
  }, [floor.tables, party]);

  async function seat(t: FloorTable, force = false) {
    if (!party) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ moved?: string[]; unplaced?: string[] }>(
      `/api/staff/floor/tables/${t.id}`,
      "POST",
      { action: "SEAT", partySize: party, ...(force ? { force: true } : {}) },
    );
    setBusy(false);
    if (!res.ok) {
      if (res.body?.code === "HELD") return setHeld({ msg: res.error, table: t });
      return setError(res.error);
    }
    const extra = [
      res.data.moved?.length ? `moved ${res.data.moved.join(", ")}` : "",
      res.data.unplaced?.length ? `${res.data.unplaced.join(", ")} needs a table` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    onDone(`Seated ${party} at ${t.name}${extra ? ` · ${extra}` : ""}`);
  }

  async function queue() {
    if (!party || !name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch("/api/staff/waitlist", "POST", {
      customerName: name.trim(),
      partySize: party,
      ...(phone.trim() ? { customerPhone: phone.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone(`${name.trim()} ×${party} added to the waiting list`);
  }

  const shortest = floor.tables
    .filter((t) => party && t.seats >= party && t.estimate)
    .map((t) => t.estimate!.readyAt)
    .sort()[0];

  return (
    <Modal
      onClose={onClose}
      maxWidthClassName="max-w-md"
      className="max-h-[92dvh] overflow-y-auto"
      ariaLabel="Walk-in"
    >
      <ModalHeader
        title={party ? `Walk-in · ${party} guest${party > 1 ? "s" : ""}` : "Walk-in: how many?"}
        onClose={onClose}
      />
      {!party ? (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setParty(n)}
              className="flex aspect-square items-center justify-center rounded-2xl bg-gray-3 text-2xl font-black text-gray-12 hover:bg-brand-3 hover:text-brand-12 active:scale-95"
            >
              {n}
            </button>
          ))}
          <div className="col-span-4 flex items-center justify-between rounded-2xl bg-gray-2 p-2 ring-1 ring-gray-5">
            <span className="text-sm font-semibold text-gray-11">Bigger group</span>
            <button onClick={() => setParty(13)} className={btn.quiet}>
              13+
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {party > 12 && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-11">Guests</span>
              <Stepper value={party} onChange={setParty} min={1} max={60} />
            </div>
          )}
          {options.length > 0 ? (
            <>
              <p className="text-sm font-semibold text-gray-11">
                Free now, best fit first. Tap to seat.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {options.map(({ t, fit }) => {
                  const soonBooking = t.next && minsUntil(t.next.startAt, now) < 150;
                  return (
                    <button
                      key={t.id}
                      disabled={busy}
                      onClick={() => seat(t)}
                      className={cn(
                        "flex min-h-20 flex-col items-start justify-center rounded-2xl p-3 text-left ring-2 transition active:scale-[0.98]",
                        fit === "fits"
                          ? "bg-success-2 ring-success-7 hover:bg-success-3"
                          : "bg-tangerine-2 ring-tangerine-6",
                      )}
                    >
                      <span className="text-lg font-black text-gray-12">{t.name}</span>
                      <span className="text-xs text-gray-11">
                        {t.seats} seats · {t.area}
                      </span>
                      {fit === "soon" && (
                        <span className="text-xs font-semibold text-tangerine-11">
                          being cleaned
                        </span>
                      )}
                      {soonBooking && (
                        <span className="text-xs font-semibold text-tangerine-11">
                          booked {clock(t.next!.startAt, floor.restaurant.timeZone)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-2xl bg-tangerine-2 p-3 text-sm text-gray-12 ring-1 ring-tangerine-6">
              <p className="font-bold">No single table for {party} is free.</p>
              <p className="text-gray-11">
                {shortest
                  ? `The first one should be ready around ${clock(shortest, floor.restaurant.timeZone)} (estimate). `
                  : ""}
                Push tables together on the floor, or add them to the waiting list.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onPickOnFloor(party)} className={btn.quiet}>
              <Hand className="size-4" /> Pick on floor
            </button>
            <button onClick={() => setQueueing(!queueing)} className={btn.accent}>
              <ListPlus className="size-4" /> Waiting list
            </button>
          </div>

          {queueing && (
            <div className="space-y-2 rounded-2xl bg-gray-2 p-3 ring-1 ring-gray-5">
              <input
                className={fieldCls}
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <input
                className={fieldCls}
                placeholder="WhatsApp number (for the 'table ready' message)"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <button
                disabled={busy || !name.trim()}
                onClick={() => void queue()}
                className={cn(btn.accent, "w-full")}
              >
                Add {party} to the waiting list
              </button>
            </div>
          )}

          {held && (
            <div role="alert" className="rounded-xl bg-tangerine-3 p-3 text-sm text-tangerine-12">
              <p>{held.msg}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={() => setHeld(null)} className={btn.quiet}>
                  Another table
                </button>
                <button
                  onClick={() => {
                    const t = held.table;
                    setHeld(null);
                    void seat(t, true);
                  }}
                  className={btn.accent}
                >
                  Seat anyway
                </button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-danger-3 p-3 text-sm text-danger-12">
              {error}
            </p>
          )}
          <button
            onClick={() => setParty(null)}
            className="text-sm font-semibold text-gray-11 underline"
          >
            Change number of guests
          </button>
        </div>
      )}
    </Modal>
  );
}
