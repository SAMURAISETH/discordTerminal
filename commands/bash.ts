import { ChannelStore, GuildStore } from "@webpack/common";

import { CliError, Line, ln, norm, s } from "../types";
import { listChannels } from "./channels";
import { moveIntoFolder } from "./folders";
import { dmLabel, FolderInfo, findFolder, findGuild, getFolders, PrivateChannelSortStore, SortedGuildStore } from "./resolve";

const PINNED = new Set(["pinned", "pinned-dms", "pinned dms", "pinned_dms"]);
const SERVER_WORDS = new Set(["servers", "server", "communities", "community"]);
const DM_WORDS = new Set(["dms", "dm", "chats"]);

const serverLine = (name: string, id: string, folder?: string): Line =>
    ln(s(name, "server"), s(`  ${id}`, "dim"), folder ? s(`  in ${folder}/`, "dim") : "");

function lsRoot(): Line[] {
    const out: Line[] = [];
    for (const entry of SortedGuildStore.getGuildFolders()) {
        if (entry.folderId != null) {
            const n = entry.guildIds.length;
            out.push(ln(s(`${entry.folderName || `folder-${entry.folderId}`}/`, "folder"), s(`  ${n} server${n === 1 ? "" : "s"}`, "dim")));
        } else {
            for (const id of entry.guildIds) {
                const guild = GuildStore.getGuild(String(id));
                if (guild) out.push(serverLine(guild.name, guild.id));
            }
        }
    }
    out.push(ln(s("pinned-dms/", "folder")));
    return out;
}

function lsFolder(folder: FolderInfo): Line[] {
    const out = folder.guildIds
        .map(id => GuildStore.getGuild(id))
        .filter(Boolean)
        .map(g => serverLine(g.name, g.id));
    return out.length ? out : [ln(s("(empty)", "dim"))];
}

function dmLines(ids: string[]): Line[] {
    const out: Line[] = [];
    for (const id of ids) {
        const channel = ChannelStore.getChannel(id);
        if (!channel) continue;
        out.push(ln(
            s(dmLabel(channel), "dm"),
            s(channel.type === 3 ? "  group" : "  dm", "dim"),
            s(`  ${channel.id}`, "dim")
        ));
    }
    return out.length ? out : [ln(s("(none)", "dim"))];
}

function lsAll(what: string): Line[] {
    if (SERVER_WORDS.has(what)) {
        const out: Line[] = [];
        const placed = new Set<string>();
        for (const folder of getFolders()) {
            for (const id of folder.guildIds) {
                const g = GuildStore.getGuild(id);
                if (g) {
                    out.push(serverLine(g.name, g.id, folder.name));
                    placed.add(id);
                }
            }
        }
        for (const g of GuildStore.getGuildsArray()) {
            if (!placed.has(g.id)) out.push(serverLine(g.name, g.id));
        }
        return out.length ? out : [ln(s("(none)", "dim"))];
    }

    if (DM_WORDS.has(what)) return dmLines(PrivateChannelSortStore.getPrivateChannelIds());

    throw new CliError("usage: ls -a <servers|dms>");
}

function lsPinned(): Line[] {
    const [first, second] = PrivateChannelSortStore.getSortedChannels();
    const pinned = [...first, ...second].filter(e => e.isFavorite).map(e => e.channelId);
    return pinned.length ? dmLines([...new Set(pinned)]) : [ln(s("(no pinned DMs)", "dim"))];
}

function ls(args: string[]): Line[] {
    const flags = args.filter(a => a.startsWith("-"));
    const pos = args.filter(a => !a.startsWith("-"));

    const bad = flags.find(f => f !== "-a");
    if (bad) throw new CliError(`ls: unknown option '${bad}'`);

    if (flags.includes("-a")) return lsAll(norm(pos.join(" ")));
    if (!pos.length) return lsRoot();
    if (PINNED.has(norm(pos.join(" ")))) return lsPinned();

    const out: Line[] = [];
    for (const target of pos) {
        const folder = findFolder(target);
        let body: Line[];

        if (folder) {
            body = lsFolder(folder);
        } else if (PINNED.has(norm(target))) {
            body = lsPinned();
        } else {
            try {
                body = listChannels(findGuild(target));
            } catch {
                throw new CliError(`ls: cannot access '${target}': no such folder or server`);
            }
        }

        if (pos.length > 1) out.push(ln(s(`${target}:`, "cat")));
        out.push(...body);
        if (pos.length > 1) out.push([]);
    }
    return out;
}

async function mkdir(args: string[]): Promise<Line[]> {
    const parents = args.includes("-p");
    const rest = args.filter(a => a !== "-p");

    const bad = rest.find(a => a.startsWith("-"));
    if (bad) throw new CliError(`mkdir: unknown option '${bad}'`);
    if (!rest.length) throw new CliError("usage: mkdir <folder> <server...>   or   mkdir -p <folder/server>...");

    const jobs: { folder: string; servers: string[]; }[] = [];

    if (parents) {
        for (const arg of rest) {
            const parts = arg.split("/");
            if (parts.length > 2) throw new CliError(`mkdir: '${arg}': folders cannot be put inside folders`);
            if (parts.length < 2 || !parts[0] || !parts[1]) throw new CliError(`mkdir: '${arg}': expected <folder>/<server>`);

            let job = jobs.find(j => norm(j.folder) === norm(parts[0]));
            if (!job) jobs.push(job = { folder: parts[0], servers: [] });
            job.servers.push(parts[1]);
        }
    } else {
        const [folder, ...servers] = rest;
        if (folder.includes("/")) throw new CliError("mkdir: use -p for <folder>/<server> paths");
        if (!servers.length) throw new CliError("mkdir: give at least one server, since Discord removes empty folders");
        jobs.push({ folder, servers });
    }

    const out: Line[] = [];

    for (const job of jobs) {
        const exists = findFolder(job.folder);
        if (exists && !parents) {
            throw new CliError(`mkdir: cannot create folder '${job.folder}': it exists (use mkdir -p ${job.folder}/<server> to add to it)`);
        }

        const guilds = [...new Set(job.servers.map(name => {
            try {
                return findGuild(name, true).id;
            } catch (e) {
                if (findFolder(name)) throw new CliError(`mkdir: '${name}' is a folder, and folders cannot be put inside folders`);
                throw e;
            }
        }))];

        const { created } = await moveIntoFolder(job.folder, guilds);
        const n = guilds.length;
        out.push(ln(
            s(created ? "created " : "updated ", "ok"),
            s(`${job.folder}/`, "folder"),
            s(`  ${n} server${n === 1 ? "" : "s"} moved in`, "dim")
        ));
    }

    return out;
}

export const bash = { ls, mkdir };
