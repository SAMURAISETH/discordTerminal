import { addChatBarButton, ChatBarButton, ChatBarButtonFactory, removeChatBarButton } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { createRoot } from "@webpack/common";

import { setOpen, toggle } from "./store";
import Terminal, { MAX_LINES } from "./Terminal";
import style from "./terminal.css?managed";

const settings = definePluginSettings({
    scrollback: {
        type: OptionType.NUMBER,
        description: "How many lines of output the terminal keeps",
        default: 500,
        onChange: v => { MAX_LINES.value = Math.max(50, Number(v) || 500); }
    }
});

const TerminalIcon = ({ height = 20, width = 20, className }: IconProps) => (
    <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="2" />
        <path d="m7 10 3 2.5L7 15m5 0h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const TerminalButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;
    return (
        <ChatBarButton tooltip="Terminal (Ctrl+`)" onClick={toggle}>
            <TerminalIcon />
        </ChatBarButton>
    );
};

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === "Backquote") {
        e.preventDefault();
        e.stopPropagation();
        toggle();
    }
}

export default definePlugin({
    name: "DiscordTerminal",
    description: "A terminal inside Discord with ls and mkdir for your servers, plus commands for Discord, Vencord and Vesktop settings. Toggle with Ctrl+` or the chat bar button.",
    authors: [{ name: "DiscordTerminal", id: 0n }],
    dependencies: ["UserSettingsAPI", "ChatInputButtonAPI"],
    settings,

    start() {
        MAX_LINES.value = Math.max(50, Number(settings.store.scrollback) || 500);
        enableStyle(style);

        host = document.createElement("div");
        host.id = "vc-discord-terminal";
        document.body.append(host);
        root = createRoot(host);
        const Wrapped = ErrorBoundary.wrap(Terminal, { noop: true });
        root.render(<Wrapped />);

        addChatBarButton("DiscordTerminal", TerminalButton, TerminalIcon);
        window.addEventListener("keydown", onKeyDown, true);
    },

    stop() {
        window.removeEventListener("keydown", onKeyDown, true);
        removeChatBarButton("DiscordTerminal");
        setOpen(false);
        root?.unmount();
        host?.remove();
        root = host = null;
        disableStyle(style);
    }
});
