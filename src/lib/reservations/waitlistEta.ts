/**
 * Waiting-list times, by simulation rather than a flat "about 20 minutes".
 *
 * Each table has a moment it is expected to be ready (now if it is free,
 * otherwise its estimate plus cleaning). Parties are served in queue order:
 * each takes the earliest-ready table that fits it, and that table is then
 * busy for the party's planned meal plus cleaning. A table promised to a
 * booking is unavailable through that booking's block. The result is a time
 * per party that already accounts for everyone ahead of them.
 */

export type EtaTable = {
  id: string;
  seats: number;
  minParty: number;
  /** Epoch ms the table is expected ready. */
  readyAt: number;
  /** Booked blocks [start, end) on this table, in epoch ms. */
  blocks: { start: number; end: number }[];
};

export type EtaParty = { id: string; partySize: number };

export type Eta = { at: number; tableId: string } | null;

export function waitlistEtas(
  tables: EtaTable[],
  queue: EtaParty[],
  diningMs: (partySize: number) => number,
  cleaningMs: number,
  now: number,
): Map<string, Eta> {
  const ready = new Map(tables.map((t) => [t.id, Math.max(now, t.readyAt)]));
  const result = new Map<string, Eta>();

  /** First moment ≥ `from` the table can host a meal of `len` without hitting a booking. */
  const fitAround = (t: EtaTable, from: number, len: number) => {
    let start = from;
    const sorted = [...t.blocks].sort((a, b) => a.start - b.start);
    for (const b of sorted) {
      if (b.end <= start) continue;
      if (start + len + cleaningMs <= b.start) break;
      start = Math.max(start, b.end);
    }
    return start;
  };

  for (const party of queue) {
    const len = diningMs(party.partySize);
    let best: { at: number; tableId: string; waste: number } | null = null;
    for (const t of tables) {
      if (t.seats < party.partySize || t.minParty > party.partySize) continue;
      const at = fitAround(t, ready.get(t.id)!, len);
      const waste = t.seats - party.partySize;
      if (!best || at < best.at || (at === best.at && waste < best.waste)) {
        best = { at, tableId: t.id, waste };
      }
    }
    if (!best) {
      result.set(party.id, null);
      continue;
    }
    result.set(party.id, { at: best.at, tableId: best.tableId });
    ready.set(best.tableId, best.at + len + cleaningMs);
  }
  return result;
}
