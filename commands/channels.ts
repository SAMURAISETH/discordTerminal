import { Channel, Guild } from "@vencord/discord-types";
import { ChannelStore } from "@webpack/common";

import { CliError, Line, ln, s } from "../types";
import { canView, CATEGORY } from "./resolve";

export const TYPE_NAMES: Record<number, string> = {
    0: "text",
    2: "voice",
    4: "category",
    5: "announcement",
    13: "stage",
    15: "forum",
    16: "media"
};

const VOICE_LIKE = new Set([2, 13]);

export type ChannelMode = "all" | "channels" | "categories";

export function visibleChannels(guild: Guild): Channel[] {
    return Object.values(ChannelStore.getMutableGuildChannelsForGuild(guild.id)).filter(canView);
}

const rank = (c: Channel) => VOICE_LIKE.has(c.type) ? 1 : 0;

const byPosition = (a: Channel, b: Channel) =>
    rank(a) - rank(b) || (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name);

function channelLines(channels: Channel[], indent: string): Line[] {
    const width = Math.max(0, ...channels.map(c => c.name.length));
    return channels.map(c => ln(
        indent,
        s("#", "dim"),
        s(c.name.padEnd(width), "channel"),
        s(`  ${TYPE_NAMES[c.type] ?? `type ${c.type}`}`, "dim"),
        s(`  ${c.id}`, "dim")
    ));
}

export function listChannels(guild: Guild, mode: ChannelMode = "all"): Line[] {
    const all = visibleChannels(guild);
    const categories = all.filter(c => c.type === CATEGORY).sort(byPosition);
    const channels = all.filter(c => c.type !== CATEGORY);

    const out: Line[] = [ln(s(guild.name, "server"), s(`  ${guild.id}`, "dim"))];

    if (mode === "categories") {
        if (!categories.length) out.push(ln(s("  (no categories)", "dim")));
        for (const cat of categories) {
            const n = channels.filter(c => c.parent_id === cat.id).length;
            out.push(ln("  ", s(cat.name, "cat"), s(`  ${n} channel${n === 1 ? "" : "s"}  ${cat.id}`, "dim")));
        }
        return out;
    }

    if (mode === "channels") {
        const types = [...new Set(channels.map(c => c.type))].sort((a, b) => a - b);
        if (!types.length) out.push(ln(s("  (no channels you can see)", "dim")));
        for (const type of types) {
            const group = channels.filter(c => c.type === type).sort(byPosition);
            out.push(ln(s(`  ${TYPE_NAMES[type] ?? `type ${type}`} (${group.length})`, "cat")));
            out.push(...channelLines(group, "    "));
        }
        return out;
    }

    const loose = channels.filter(c => !c.parent_id || !categories.some(cat => cat.id === c.parent_id)).sort(byPosition);
    if (loose.length) out.push(...channelLines(loose, "  "));

    for (const cat of categories) {
        out.push(ln("  ", s(cat.name, "cat"), s(`  ${cat.id}`, "dim")));
        out.push(...channelLines(channels.filter(c => c.parent_id === cat.id).sort(byPosition), "    "));
    }

    if (out.length === 1) out.push(ln(s("  (no channels you can see)", "dim")));
    return out;
}

export function findChannel(guild: Guild, query: string): Channel {
    const name = query.replace(/^#/, "").toLowerCase();
    const channels = visibleChannels(guild).filter(c => c.type !== CATEGORY);

    const byId = channels.find(c => c.id === query);
    if (byId) return byId;

    const matches = channels.filter(c => c.name.toLowerCase() === name);
    if (matches.length === 1) return matches[0];
    if (!matches.length) throw new CliError(`no channel '${query}' in ${guild.name}`);
    throw new CliError(`'${query}' matches several channels in ${guild.name}; use the id.`);
}
