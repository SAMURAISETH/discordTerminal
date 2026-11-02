import { plugins, startPlugin, stopPlugin } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { UserSettings } from "@api/UserSettings";

import { CliError, Line, ln, s, squash } from "../types";

interface Entry {
    /** What is shown to the person, e.g. appearance.developerMode */
    label: string;
    /** Names this entry answers to, already squashed */
    keys: string[];
    on: boolean;
    apply(on: boolean): Promise<string | void>;
}

interface Backend {
    entries(): Entry[];
}

const SELF = "DiscordTerminal";

/* ---------- Discord (user settings synced to your account) ---------- */

const discord: Backend = {
    entries() {
        const out: Entry[] = [];
        if (!UserSettings) return out;

        for (const key in UserSettings) {
            const def = UserSettings[key];
            let value: unknown;
            try {
                value = def.getSetting();
            } catch {
                continue;
            }
            if (typeof value !== "boolean") continue;

            const { userSettingsAPIGroup: group, userSettingsAPIName: name } = def;
            out.push({
                label: `${group}.${name}`,
                keys: [squash(name), squash(`${group}.${name}`)],
                on: value,
                apply: on => def.updateSetting(on)
            });
        }
        return out;
    }
};

/* ---------- Vencord (its own settings, plus plugins by name) ---------- */

const vencord: Backend = {
    entries() {
        const out: Entry[] = [];

        for (const key of Object.keys(Settings)) {
            const value = (Settings as any)[key];
            if (typeof value !== "boolean") continue;

            out.push({
                label: key,
                keys: [squash(key)],
                on: value,
                apply: async on => {
                    (Settings as any)[key] = on;
                    return "may need a reload to take effect";
                }
            });
        }

        for (const plugin of Object.values(plugins)) {
            out.push({
                label: `plugin ${plugin.name}`,
                keys: [squash(plugin.name), squash(`plugin.${plugin.name}`)],
                on: !!Settings.plugins[plugin.name]?.enabled,
                apply: async on => {
                    if (plugin.name === SELF) throw new CliError("the terminal cannot switch itself off; use the plugin list in settings");
                    if (plugin.required) throw new CliError(`${plugin.name} is required and cannot be switched`);

                    const settings = Settings.plugins[plugin.name];
                    if (!settings) throw new CliError(`${plugin.name} has no settings entry`);

                    if (plugin.patches?.length) {
                        settings.enabled = on;
                        return "restart Discord (Ctrl+R) to apply, since this plugin patches Discord's code";
                    }

                    if (on) {
                        if (!startPlugin(plugin)) throw new CliError(`${plugin.name} failed to start; see the console`);
                    } else if (!stopPlugin(plugin)) {
                        throw new CliError(`${plugin.name} failed to stop; see the console`);
                    }
                    settings.enabled = on;
                }
            });
        }

        return out;
    }
};

/* ---------- Vesktop (desktop app settings) ---------- */

function vesktopApi() {
    const api = (window as any).VesktopNative?.settings;
    if (!api) throw new CliError("this is not Vesktop, so there are no Vesktop settings here");
    return api as { get(): Record<string, unknown>; set(settings: Record<string, unknown>): Promise<void>; };
}

const vesktop: Backend = {
    entries() {
        const api = vesktopApi();
        const current = api.get();
        return Object.keys(current)
            .filter(key => typeof current[key] === "boolean")
            .map(key => ({
                label: key,
                keys: [squash(key)],
                on: current[key] as boolean,
                apply: async (on: boolean) => {
                    await api.set({ ...api.get(), [key]: on });
                    return "some Vesktop settings need a restart";
                }
            }));
    }
};

const BACKENDS: Record<string, Backend> = { discord, vencord, vesktop };

/** Accepts `a b c`, `a, b, c` and `[a, b, c]`. */
function parseNames(raw: string[]): string[] {
    return raw.join(" ").replace(/[[\]]/g, " ").split(/[,\s]+/).filter(Boolean);
}

export async function settingsCommand(app: string, args: string[]): Promise<Line[]> {
    const [sub, action, ...rawNames] = args;
    if (sub !== "setting" && sub !== "settings") {
        throw new CliError(`usage: ${app} setting <enable|disable> <name>   or   ${app} settings <enable|disable> [a, b, c]`);
    }

    const backend = BACKENDS[app];
    const entries = backend.entries();

    if (!action) {
        const out: Line[] = [ln(s(`${app} settings you can toggle`, "cat"))];
        for (const e of entries.sort((a, b) => a.label.localeCompare(b.label))) {
            out.push(ln("  ", s(e.on ? "on " : "off", e.on ? "ok" : "dim"), "  ", e.label));
        }
        return out;
    }

    const on = ({ enable: true, on: true, disable: false, off: false } as Record<string, boolean>)[action];
    if (on === undefined) throw new CliError(`${app} ${sub}: expected 'enable' or 'disable', got '${action}'`);

    const names = parseNames(rawNames);
    if (!names.length) throw new CliError(`${app} ${sub} ${action}: which setting? Run '${app} setting' to list them.`);

    const out: Line[] = [];
    for (const name of names) {
        const key = squash(name);
        const matches = entries.filter(e => e.keys.includes(key));

        if (!matches.length) {
            const near = entries.filter(e => e.keys.some(k => k.includes(key))).slice(0, 4).map(e => e.label);
            out.push(ln(s(`${name}: no such setting`, "err"), near.length ? s(`  did you mean ${near.join(", ")}?`, "dim") : ""));
            continue;
        }
        if (matches.length > 1) {
            out.push(ln(s(`${name}: ambiguous, use one of ${matches.map(m => m.label).join(", ")}`, "err")));
            continue;
        }

        const entry = matches[0];
        try {
            const note = await entry.apply(on);
            out.push(ln(s(on ? "enabled  " : "disabled ", "ok"), entry.label, note ? s(`  ${note}`, "dim") : ""));
        } catch (e) {
            out.push(ln(s(`${entry.label}: ${e instanceof Error ? e.message : String(e)}`, "err")));
        }
    }
    return out;
}
