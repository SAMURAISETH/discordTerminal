import { GuildStore, React, useEffect, useRef, useState } from "@webpack/common";

import { getFolders } from "./commands/resolve";
import { COMMAND_NAMES, execute } from "./shell";
import { isOpen, setOpen, subscribe } from "./store";
import { Line, ln, s } from "./types";

/** Kept outside the component so scrollback and history survive closing the terminal. */
const session = {
    lines: [ln(s("Discord terminal. Type 'help' for commands, Ctrl+` to hide.", "dim"))] as Line[],
    history: [] as string[],
    height: 320
};

export const MAX_LINES = { value: 500 };

function push(lines: Line[]) {
    session.lines.push(...lines);
    if (session.lines.length > MAX_LINES.value) session.lines.splice(0, session.lines.length - MAX_LINES.value);
}

function candidates(first: boolean): string[] {
    if (first) return COMMAND_NAMES;
    const names = [
        "servers", "dms", "pinned-dms", "setting", "settings", "enable", "disable", "all", "channels", "categories",
        "-server", "-dm", "-a", "-p", "-c", "-m", "-f", "-n", "id", "username", "displayname"
    ];
    for (const g of GuildStore.getGuildsArray()) names.push(g.name);
    for (const f of getFolders()) names.push(f.name);
    return names;
}

const quoteIfNeeded = (v: string) => /\s/.test(v) ? `"${v}"` : v;

function complete(input: string): string {
    const m = input.match(/^(.*?)(\S*)$/s)!;
    const head = m[1];
    const word = m[2].replace(/^["']/, "");
    if (!word) return input;

    const first = head.trim() === "";
    const pool = candidates(first).filter(c => c.toLowerCase().startsWith(word.toLowerCase()));
    if (!pool.length) return input;

    let common = pool[0];
    for (const c of pool) {
        while (!c.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1);
    }
    return head + quoteIfNeeded(pool.length === 1 ? pool[0] : common);
}

export default function Terminal() {
    const [open, setOpenState] = useState(isOpen());
    const [, bump] = useState(0);
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const [height, setHeight] = useState(session.height);

    const inputRef = useRef<HTMLInputElement>(null);
    const outRef = useRef<HTMLDivElement>(null);
    const historyPos = useRef(-1);
    const draft = useRef("");

    useEffect(() => subscribe(() => setOpenState(isOpen())), []);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    useEffect(() => {
        const el = outRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    });

    if (!open) return null;

    const refresh = () => bump(n => n + 1);

    async function submit() {
        if (busy) return;
        const input = value;
        setValue("");
        historyPos.current = -1;

        push([ln(s("$ ", "prompt"), input)]);
        refresh();
        if (!input.trim()) return;

        if (session.history[session.history.length - 1] !== input) session.history.push(input);

        setBusy(true);
        const outcome = await execute(input);
        setBusy(false);

        if (outcome.action === "clear") session.lines = [];
        else push(outcome.lines);

        if (outcome.action === "close") setOpen(false);
        refresh();
        inputRef.current?.focus();
    }

    function recall(direction: -1 | 1) {
        const { history } = session;
        if (!history.length) return;

        if (historyPos.current === -1) {
            if (direction === 1) return;
            draft.current = value;
            historyPos.current = history.length - 1;
        } else {
            historyPos.current += direction === -1 ? -1 : 1;
        }

        if (historyPos.current < 0) historyPos.current = 0;
        if (historyPos.current >= history.length) {
            historyPos.current = -1;
            setValue(draft.current);
        } else {
            setValue(history[historyPos.current]);
        }
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        // Keep Discord's own shortcuts from firing while typing here.
        e.stopPropagation();

        if (e.key === "Enter") {
            e.preventDefault();
            void submit();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            recall(-1);
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            recall(1);
        } else if (e.key === "Tab") {
            e.preventDefault();
            setValue(complete(value));
        } else if (e.key === "Escape") {
            setOpen(false);
        } else if (e.ctrlKey && e.key.toLowerCase() === "l") {
            e.preventDefault();
            session.lines = [];
            refresh();
        } else if (e.ctrlKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
            e.preventDefault();
            push([ln(s("$ ", "prompt"), value, s("^C", "dim"))]);
            setValue("");
            refresh();
        }
    }

    function startResize(e: React.PointerEvent<HTMLDivElement>) {
        e.preventDefault();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);

        const move = (ev: PointerEvent) => {
            const next = Math.min(window.innerHeight * 0.85, Math.max(120, window.innerHeight - ev.clientY));
            session.height = next;
            setHeight(next);
        };
        const stop = () => {
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", stop);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", stop);
    }

    return (
        <div className="vcTerm" style={{ height }} role="region" aria-label="Terminal">
            <div className="vcTerm-grip" onPointerDown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize terminal" />
            <div className="vcTerm-bar">
                <span>terminal</span>
                <button className="vcTerm-close" onClick={() => setOpen(false)} aria-label="Close terminal">×</button>
            </div>
            <div
                className="vcTerm-out"
                ref={outRef}
                onClick={() => { if (!window.getSelection()?.toString()) inputRef.current?.focus(); }}
            >
                {session.lines.map((line, i) => (
                    <div className="vcTerm-line" key={i}>
                        {line.map((seg, j) => <span key={j} className={seg.c ? `vcTerm-${seg.c === "prompt" ? "prompt-echo" : seg.c}` : undefined}>{seg.t}</span>)}
                    </div>
                ))}
            </div>
            <div className="vcTerm-in">
                <span className="vcTerm-prompt" aria-hidden="true">$</span>
                <input
                    ref={inputRef}
                    className="vcTerm-input"
                    value={value}
                    onChange={e => setValue(e.currentTarget.value)}
                    onKeyDown={onKeyDown}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    aria-label="Terminal input"
                    aria-busy={busy}
                />
            </div>
        </div>
    );
}
