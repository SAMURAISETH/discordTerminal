type Listener = () => void;

const listeners = new Set<Listener>();
let open = false;

export const isOpen = () => open;

export function setOpen(value: boolean) {
    if (value === open) return;
    open = value;
    listeners.forEach(l => l());
}

export const toggle = () => setOpen(!open);

export function subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
}
