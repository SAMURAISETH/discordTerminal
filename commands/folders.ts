import { UserSettingsActionCreators } from "@webpack/common";

import { findFolder } from "./resolve";

/*
 * Discord keeps server folders in the PreloadedUserSettings protobuf:
 *   guildFolders.folders[] = { id?: { value }, name?: { value }, guildIds: [...] }
 * A server that is not in a folder is an entry with no id and a single guild id.
 * The exact number types (bigint or number) differ between client builds, so new values copy the type of an existing entry.
 */

const idOf = (f: any) => f.id == null ? null : String(f.id.value ?? f.id);

function randomFolderId(sample: any): number | bigint {
    const value = Math.floor(Math.random() * 2 ** 31);
    const existing = sample?.id?.value ?? sample?.id;
    return typeof existing === "number" ? value : BigInt(value);
}

export interface MoveResult {
    created: boolean;
}

/** Moves the given servers into the named folder, creating the folder when it does not exist yet. */
export async function moveIntoFolder(folderName: string, guildIds: string[]): Promise<MoveResult> {
    const existing = findFolder(folderName);
    const Preloaded = UserSettingsActionCreators.PreloadedUserSettingsActionCreators;

    await Preloaded.updateAsync("guildFolders", (gf: any) => {
        const { folders } = gf as { folders: any[]; };
        const moving = new Set(guildIds);

        const sampleFolder = folders.find(f => f.id != null);
        const sampleGuildId = folders.find(f => f.guildIds.length)?.guildIds[0];
        const asGuildId = (id: string) => typeof sampleGuildId === "bigint" ? BigInt(id) : id;

        const kept: any[] = [];
        let insertAt = -1;
        let target: any;

        for (const folder of folders) {
            if (existing && idOf(folder) === String(existing.id)) {
                target = folder;
                kept.push(folder);
                continue;
            }

            const touched = folder.guildIds.some((id: any) => moving.has(String(id)));
            if (touched && insertAt < 0) insertAt = kept.length;

            folder.guildIds = folder.guildIds.filter((id: any) => !moving.has(String(id)));
            if (folder.guildIds.length) kept.push(folder);
        }

        if (target) {
            const present = new Set(target.guildIds.map(String));
            for (const id of guildIds) {
                if (!present.has(id)) target.guildIds.push(asGuildId(id));
            }
        } else {
            kept.splice(insertAt < 0 ? kept.length : insertAt, 0, {
                id: { value: randomFolderId(sampleFolder) },
                name: { value: folderName },
                guildIds: guildIds.map(asGuildId)
            });
        }

        gf.folders = kept;
    }, 0);

    return { created: !existing };
}
