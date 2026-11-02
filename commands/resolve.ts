import { Channel, Guild } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, GuildStore, PermissionsBits, PermissionStore, RelationshipStore, UserStore } from "@webpack/common";

export const SortedGuildStore = findStoreLazy("SortedGuildStore");
export const PrivateChannelSortStore = findStoreLazy("PrivateChannelSortStore");

import { CliError, norm } from "../types";

export const DM = 1;
export const GROUP_DM = 3;
export const CATEGORY = 4;

export interface FolderInfo {
    id: number;
    name: string;
    guildIds: string[];
}

/** Discord stores servers that are not in a folder as folder entries with no id. Those are skipped here. */
export function getFolders(): FolderInfo[] {
    return SortedGuildStore.getGuildFolders()
        .filter(f => f.folderId != null)
        .map(f => ({
            id: f.folderId!,
            name: f.folderName || `folder-${f.folderId}`,
            guildIds: f.guildIds.map(String)
        }));
}

export function findFolder(query: string): FolderInfo | undefined {
    const n = norm(query);
    return getFolders().find(f => String(f.id) === query || norm(f.name) === n);
}

export function guildFolderOf(guildId: string): FolderInfo | undefined {
    return getFolders().find(f => f.guildIds.includes(guildId));
}

/**
 * Finds a server you are in. Strict mode (used before anything is changed) accepts only an id or the full name.
 * Loose mode also accepts a unique partial name.
 */
export function findGuild(query: string, strict = false): Guild {
    const guilds = GuildStore.getGuildsArray();
    const n = norm(query);

    const byId = guilds.find(g => g.id === query);
    if (byId) return byId;

    const exact = guilds.filter(g => norm(g.name) === n);
    const pool = exact.length || strict ? exact : guilds.filter(g => norm(g.name).includes(n));

    if (pool.length === 1) return pool[0];
    if (!pool.length) throw new CliError(`no server matches '${query}' (only servers you are in can be reached)`);
    throw new CliError(`'${query}' matches several servers: ${pool.map(g => `${g.name} (${g.id})`).join(", ")}. Use the id.`);
}

export function userLabel(userId: string): string {
    const user = UserStore.getUser(userId);
    if (!user) return userId;
    return RelationshipStore.getNickname(userId) || user.globalName || user.username;
}

export function dmLabel(channel: Channel): string {
    const recipients: string[] = channel.recipients ?? [];
    if (channel.type === GROUP_DM) {
        return channel.name || recipients.map(userLabel).join(", ") || channel.id;
    }
    return recipients.length ? userLabel(recipients[0]) : channel.id;
}

export function canView(channel: Channel): boolean {
    return PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel);
}

export function findDm(query: string): Channel {
    const n = norm(query);
    const channels = ChannelStore.getSortedPrivateChannels();

    const byId = channels.find(c => c.id === query);
    if (byId) return byId;

    const matches = channels.filter(c => {
        if (norm(dmLabel(c)) === n) return true;
        return (c.recipients ?? []).some((id: string) => norm(UserStore.getUser(id)?.username ?? "") === n);
    });

    if (matches.length === 1) return matches[0];
    if (!matches.length) throw new CliError(`no DM or group chat matches '${query}'`);
    throw new CliError(`'${query}' matches several chats: ${matches.map(c => `${dmLabel(c)} (${c.id})`).join(", ")}. Use the id.`);
}
