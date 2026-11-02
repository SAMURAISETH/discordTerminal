import { bash } from "./commands/bash";
import { discordCli } from "./commands/discordCli";
import { CliError, Line, ln, s } from "./types";

export interface Outcome {
    lines: Line[];
    action?: "clear" | "close";
}

type Handler = (args: string[]) => Line[] | Promise<Line[]>;

export function tokenize(input: string): string[] {
    const out: string[] = [];
    let cur = "";
    let quote: string | null = null;
    let started = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (quote) {
            if (ch === quote) quote = null;
            else if (ch === "\\" && quote === "\"" && i + 1 < input.length) cur += input[++i];
            else cur += ch;
        } else if (ch === "\"" || ch === "'") {
            quote = ch;
            started = true;
        } else if (ch === "\\" && i + 1 < input.length) {
            cur += input[++i];
            started = true;
        } else if (/\s/.test(ch)) {
            if (cur || started) out.push(cur);
            cur = "";
            started = false;
        } else {
            cur += ch;
        }
    }

    if (quote) throw new CliError(`unterminated ${quote} quote`);
    if (cur || started) out.push(cur);
    return out;
}

const HELP: Line[] = [
    ln(s("files", "cat")),
    ln("  ls [folder|pinned-dms]           list server folders, or what is in one"),
    ln("  ls -a <servers|dms>              list every server, or every DM and group chat"),
    ln("  mkdir <folder> <server...>       make a folder and move servers into it"),
    ln("  mkdir -p <folder/server>...      same, adding to the folder if it already exists"),
    ln(s("discord, vencord, vesktop", "cat")),
    ln("  <app> setting <enable|disable> <name>"),
    ln("  <app> settings <enable|disable> [name1, name2, ...]"),
    ln("  <app> setting                    with no names, list what can be toggled"),
    ln(s("create", "cat")),
    ln("  create -server <name>"),
    ln("  create -dm <name> <user_id...>   one id opens a DM, two or more make a group chat"),
    ln("  create -<server>/<type> <name>   type: text voice category announcement stage forum"),
    ln("  create -<server>/<category>/<type> <name>"),
    ln(s("list", "cat")),
    ln("  list -c <server> [all|channels|categories]"),
    ln("  list -m <server/channel | serverid/channelid | dm | dm_id | dm/username> [-n count]"),
    ln("  list -f [id|username|displayname]"),
    ln(s("terminal", "cat")),
    ln("  clear   exit   help      Ctrl+` toggles the terminal, Tab completes, Up/Down recalls"),
    ln(s("Quote names that contain spaces: ls \"My Folder\"", "dim")),
];

const handlers: Record<string, Handler> = {
    ls: bash.ls,
    mkdir: bash.mkdir,
    create: discordCli.create,
    list: discordCli.list,
    help: () => HELP,
};

for (const app of ["discord", "vencord", "vesktop"]) {
    handlers[app] = args => discordCli.settings(app, args);
}

export const COMMAND_NAMES = [...Object.keys(handlers), "clear", "exit"];

export async function execute(input: string): Promise<Outcome> {
    try {
        const tokens = tokenize(input);
        if (!tokens.length) return { lines: [] };

        const [cmd, ...args] = tokens;
        if (cmd === "clear") return { lines: [], action: "clear" };
        if (cmd === "exit") return { lines: [], action: "close" };

        const handler = handlers[cmd];
        if (!handler) throw new CliError(`${cmd}: command not found (try 'help')`);
        return { lines: await handler(args) };
    } catch (e) {
        if (e instanceof CliError) return { lines: [ln(s(e.message, "err"))] };
        console.error("[DiscordTerminal]", e);
        const msg = e instanceof Error ? e.message : String(e);
        return { lines: [ln(s(`unexpected error: ${msg}`, "err"))] };
    }
}
