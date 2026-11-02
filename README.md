# DiscordTerminal

A terminal inside Discord for Vencord / Vesktop. Toggle it with Ctrl+` or the chat bar button.

## Install

1. Build Vencord from source (userplugins need a source checkout): https://docs.vencord.dev/installing/custom-plugins/
2. Put this folder at `src/userplugins/discordTerminal`
3. `pnpm build`, then `pnpm inject` (Discord) or point Vesktop at your `dist` folder
4. Enable **DiscordTerminal** in Vencord's plugin list

## Commands

Run `help` in the terminal. Quote names that contain spaces.

    ls [folder|pinned-dms]            ls -a <servers|dms>
    mkdir <folder> <server...>        mkdir -p <folder/server>...
    discord|vencord|vesktop setting <enable|disable> <name>
    discord|vencord|vesktop settings <enable|disable> [a, b, c]
    create -server <name>             create -dm <name> <user_id...>
    create -<server>/<type> <name>    create -<server>/<category>/<type> <name>
    list -c <server> [all|channels|categories]
    list -m <channel> [-n count]      list -f [id|username|displayname]
