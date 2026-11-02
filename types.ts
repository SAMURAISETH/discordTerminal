/** Colour classes a segment of terminal output can carry. */
export type Cls = "dim" | "err" | "ok" | "warn" | "folder" | "server" | "dm" | "channel" | "cat" | "user" | "prompt";

export interface Seg {
    t: string;
    c?: Cls;
}

export type Line = Seg[];

/** An error whose message is meant to be shown to the person at the terminal as-is. */
export class CliError extends Error { }

export const s = (t: string, c?: Cls): Seg => ({ t, c });

export const ln = (...parts: (string | Seg)[]): Line =>
    parts.map(p => typeof p === "string" ? { t: p } : p);

export const norm = (v: string) => v.trim().toLowerCase();

/** Same as norm but ignores separators, so "developer-mode" matches "developerMode". */
export const squash = (v: string) => norm(v).replace(/[-_\s]/g, "");
