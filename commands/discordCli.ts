import { ChannelStore, PermissionsBits, PermissionStore, RelationshipStore, RestAPI, UserStore } from "@webpack/common";

import { CliError, Line, ln, norm, s } from "../types";
import { ChannelMode, findChannel, listChannels, TYPE_NAMES, visibleChannels } from "./channels";
import { canView, CATEGORY, dmLabel, findDm, findGuild, userLabel } from "./resolve";
import { settingsCommand } from "./settings";

const SNOWFLAKE = /^\d{15,21}$/;

/* ------------------------------ create ------------------------------ */

const CHANNEL_TYPES: Record<string, number> = {
    text: 0,
    voice: 2,
    category: 4,
    announcement: 5,
    news: 5,
    stage: 13,
    forum: 15,
    media: 16
};

// Template code the client uses for "Create My Own".
const BLANK_SERVER_TEMPLATE = "2TffvPucqHkN";

async function createServer(name: string): Promise<Line[]> {
    const res = await RestAPI.post({
        url: "/guilds",
        body: { name, icon: null, channels: [], system_channel_id: null, guild_template_code: BLANK_SERVER_TEMPLATE }
    });
    return [ln(s("created server ", "ok"), s(res.body.name, "server"), s(`  ${res.body.id}`, "dim"))];
}

async function createDm(name: string, ids: string[]): Promise<Line[]> {
    const unique = [...new Set(ids)];
    const badId = unique.find(id => !SNOWFLAKE.test(id));
    if (badId) throw new CliError(`create -dm: '${badId}' is not a user id`);
    if (!unique.length) throw new CliError("create -dm <name> <user_id...>: a DM needs at least one user id (you are included automatically)");

    if (unique.length === 1) {
        const res = await RestAPI.post({ url: "/users/@me/channels", body: { recipient_id: unique[0] } });
        return [
            ln(s("opened DM with ", "ok"), s(userLabel(unique[0]), "dm"), s(`  ${res.body.id}`, "dim")),
            ln(s("a one-to-one DM has no name, so '" + name + "' was not used", "dim"))
        ];
    }

    const res = await RestAPI.post({ url: "/users/@me/channels", body: { recipients: unique } });
    await RestAPI.patch({ url: `/channels/${res.body.id}`, body: { name } });
    return [ln(s("created group chat ", "ok"), s(name, "dm"), s(`  ${unique.length + 1} people  ${res.body.id}`, "dim"))];
}

async function createChannel(path: string, name: string): Promise<Line[]> {
    const parts = path.split("/");
    if (parts.length < 2 || parts.length > 3 || parts.some(p => !p)) {
        throw new CliError("create -<server>/<type> <name>   or   create -<server>/<category>/<type> <name>");
    }

    const typeName = norm(parts[parts.length - 1]);
    const type = CHANNEL_TYPES[typeName];
    if (type === undefined) throw new CliError(`create: unknown type '${typeName}'. Use ${Object.keys(CHANNEL_TYPES).filter(t => t !== "news").join(", ")}.`);

    const guild = findGuild(parts[0], true);
    if (!PermissionStore.can(PermissionsBits.MANAGE_CHANNELS, guild)) {
        throw new CliError(`create: you do not have Manage Channels in ${guild.name}`);
    }

    let parentId: string | undefined;
    if (parts.length === 3) {
        if (type === CATEGORY) throw new CliError("create: categories cannot be put inside categories");
        const wanted = norm(parts[1]);
        const cats = visibleChannels(guild).filter(c => c.type === CATEGORY && (c.id === parts[1] || norm(c.name) === wanted));
        if (cats.length !== 1) throw new CliError(cats.length ? `create: several categories are named '${parts[1]}'; use the id` : `create: no category '${parts[1]}' in ${guild.name}`);
        parentId = cats[0].id;
    }

    // The client turns "My Channel" into "my-channel" for text-like channels; do the same here.
    const finalName = type === CATEGORY || type === 2 || type === 13 ? name : name.toLowerCase().replace(/\s+/g, "-");

    const res = await RestAPI.post({
        url: `/guilds/${guild.id}/channels`,
        body: { name: finalName, type, parent_id: parentId }
    });
    return [ln(s(`created ${TYPE_NAMES[type]} `, "ok"), s(`${guild.name}/`, "server"), s(res.body.name, "channel"), s(`  ${res.body.id}`, "dim"))];
}

async function create(args: string[]): Promise<Line[]> {
    const [flag, name, ...ids] = args;
    const usage = "usage: create -server <name>   |   create -dm <name> <user_id...>   |   create -<server>/<type> <name>";
    if (!flag || !flag.startsWith("-") || flag.length < 2 || !name) throw new CliError(usage);

    const kind = flag.slice(1);
    if (kind === "server") {
        if (ids.length) throw new CliError("create -server takes only a name");
        return createServer(name);
    }
    if (kind === "dm") return createDm(name, ids);
    if (kind.includes("/")) {
        if (ids.length) throw new CliError("creating a channel takes only a name");
        return createChannel(kind, name);
    }
    throw new CliError(usage);
}

/* ------------------------------- list ------------------------------- */

function listFriends(field: string | undefined): Line[] {
    const what = norm(field ?? "all");
    if (!["all", "id", "username", "displayname"].includes(what)) {
        throw new CliError("usage: list -f [id|username|displayname]");
    }

    const friends = RelationshipStore.getFriendIDs()
        .map(id => UserStore.getUser(id))
        .filter(Boolean)
        .sort((a, b) => a.username.localeCompare(b.username));

    if (!friends.length) return [ln(s("(no friends loaded)", "dim"))];

    const display = (u: typeof friends[number]) => RelationshipStore.getNickname(u.id) || u.globalName || u.username;
    const width = Math.max(...friends.map(u => u.username.length));

    const out = friends.map(u => {
        if (what === "id") return ln(s(u.id, "dim"));
        if (what === "username") return ln(s(u.username, "user"));
        if (what === "displayname") return ln(s(display(u), "user"));
        return ln(s(u.username.padEnd(width), "user"), "  ", display(u), s(`  ${u.id}`, "dim"));
    });
    out.push(ln(s(`${friends.length} friend${friends.length === 1 ? "" : "s"}`, "dim")));
    return out;
}

async function listMessages(target: string | undefined, count: number): Promise<Line[]> {
    if (!target) throw new CliError("usage: list -m <server/channel | serverid/channelid | dm | dm_id | dm/username> [-n count]");

    if (norm(target) === "dm") {
        const out = ChannelStore.getSortedPrivateChannels().map(c => ln(s(dmLabel(c), "dm"), s(`  ${c.id}`, "dim")));
        return [...out, ln(s("pick one: list -m <id>  or  list -m dm/<username>", "dim"))];
    }

    let channel;
    if (target.includes("/")) {
        const slash = target.indexOf("/");
        const left = target.slice(0, slash);
        const right = target.slice(slash + 1);
        channel = norm(left) === "dm" ? findDm(right) : findChannel(findGuild(left), right);
    } else if (SNOWFLAKE.test(target)) {
        channel = ChannelStore.getChannel(target);
        if (!channel) throw new CliError(`list -m: no channel with id ${target} that you can reach`);
        if (!canView(channel)) throw new CliError("list -m: you cannot view that channel");
    } else {
        channel = findDm(target);
    }

    const res = await RestAPI.get({ url: `/channels/${channel.id}/messages`, query: { limit: count } });
    const messages: any[] = [...res.body].reverse();

    const label = channel.guild_id ? `#${channel.name}` : dmLabel(channel);
    const out: Line[] = [ln(s(label, channel.guild_id ? "channel" : "dm"), s(`  last ${messages.length}`, "dim"))];
    if (!messages.length) out.push(ln(s("(no messages)", "dim")));

    for (const m of messages) {
        const when = new Date(m.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        const author = m.author.global_name || m.author.username;
        const extras = [
            ...(m.attachments ?? []).map((a: any) => `[file: ${a.filename}]`),
            ...(m.embeds?.length && !m.content ? [`[${m.embeds.length} embed${m.embeds.length === 1 ? "" : "s"}]`] : [])
        ];
        const body = [m.content, ...extras].filter(Boolean).join(" ") || "[no text]";
        const [first, ...more] = String(body).split("\n");

        out.push(ln(s(when, "dim"), "  ", s(author, "user"), ": ", first));
        for (const extra of more) out.push(ln("    ", extra));
    }
    return out;
}

async function list(args: string[]): Promise<Line[]> {
    const [flag, ...rest] = args;
    const usage = "usage: list -c <server> [all|channels|categories]   |   list -m <channel> [-n count]   |   list -f [id|username|displayname]";

    switch (flag) {
        case "-c": {
            if (!rest[0]) throw new CliError(usage);
            const mode = norm(rest[1] ?? "all");
            if (!["all", "channels", "categories"].includes(mode)) throw new CliError("list -c: last argument must be all, channels or categories");
            return listChannels(findGuild(rest[0]), mode as ChannelMode);
        }
        case "-m": {
            const nAt = rest.indexOf("-n");
            let count = 20;
            let positional = rest;
            if (nAt >= 0) {
                count = Number(rest[nAt + 1]);
                if (!Number.isInteger(count) || count < 1 || count > 100) throw new CliError("list -m: -n needs a whole number from 1 to 100");
                positional = rest.filter((_, i) => i !== nAt && i !== nAt + 1);
            }
            return listMessages(positional[0], count);
        }
        case "-f":
            return listFriends(rest[0]);
        default:
            throw new CliError(usage);
    }
}

export const discordCli = { create, list, settings: settingsCommand };
