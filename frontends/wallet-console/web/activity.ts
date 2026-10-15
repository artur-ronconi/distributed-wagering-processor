import type { Call } from "./api";
import type { Explanation } from "./rules";

interface ActivityEntry {
  id: number;
  at: Date;
  title: string;
  call: Call<unknown>;
  explanation: Explanation;
}

const MAX = 60;
const entries: ActivityEntry[] = [];
const listeners = new Set<(entry: ActivityEntry) => void>();
let nextId = 1;

/** Every request this console made, newest first, with what it meant. Lives only in this tab. */
const activity = {
  entries: () => entries,
  add(title: string, call: Call<unknown>, explanation: Explanation) {
    const entry = { id: nextId++, at: new Date(), title, call, explanation };
    entries.unshift(entry);
    if (entries.length > MAX) entries.pop();
    listeners.forEach((listener) => listener(entry));
    return entry;
  },
  onAdd(listener: (entry: ActivityEntry) => void) {
    listeners.add(listener);
  },
};

export { activity, type ActivityEntry };
