import { Check, FolderOpen, Loader2, MoreVertical, Sparkles, Terminal } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { installAgentSkill } from "../annotationActions";
import { installCli, openRepositoryFolder } from "../repositoryActions";
import { useShallowAppSelector } from "../store";

export function TopBarMenu() {
  const { cliInstallState, commandOpen, findOpen } = useShallowAppSelector((state) => ({
    cliInstallState: state.cliInstallState,
    commandOpen: state.commandOpen,
    findOpen: state.findOpen,
  }));
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusLastOnOpen = useRef(false);
  const menuId = useId();

  // The command palette and find bar take over the same keyboard focus, so the
  // menu must not stay mounted (and marked expanded) underneath them.
  if (open && (commandOpen || findOpen)) {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const items = menuItems(menuRef.current);
    const target = focusLastOnOpen.current ? items[items.length - 1] : items[0];
    focusLastOnOpen.current = false;
    target?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const run = (action: () => void) => {
    close();
    action();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    focusLastOnOpen.current = event.key === "ArrowUp";
    setOpen(true);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }

    if (event.key === "Tab") {
      setOpen(false);
      return;
    }

    const items = menuItems(menuRef.current);
    if (items.length === 0) {
      return;
    }

    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === "ArrowDown") {
      next = (current + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      next = (current <= 0 ? items.length : current) - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = items.length - 1;
    }

    if (next !== -1) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  return (
    <div className="top-bar-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className="icon-button"
        type="button"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More actions"
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        <MoreVertical aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div
          className="top-bar-menu-popover"
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="More actions"
          onKeyDown={onMenuKeyDown}
        >
          <MenuItem icon={<FolderOpen aria-hidden="true" size={15} />} onSelect={() => run(() => void openRepositoryFolder())}>
            Open folder
          </MenuItem>
          <MenuItem
            icon={
              cliInstallState === "installing" ? (
                <Loader2 aria-hidden="true" size={15} className="spin" />
              ) : cliInstallState === "installed" ? (
                <Check aria-hidden="true" size={15} />
              ) : (
                <Terminal aria-hidden="true" size={15} />
              )
            }
            disabled={cliInstallState === "installing"}
            onSelect={() => run(() => void installCli())}
          >
            {cliInstallState === "installing" ? "Installing CLI…" : cliInstallState === "installed" ? "CLI installed" : "Install CLI"}
          </MenuItem>
          <MenuItem icon={<Sparkles aria-hidden="true" size={15} />} onSelect={() => run(() => void installAgentSkill())}>
            Install agent skill
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  disabled = false,
  icon,
  onSelect,
}: {
  children: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      className="top-bar-menu-item"
      type="button"
      role="menuitem"
      // aria-disabled rather than disabled so the item stays in the arrow-key
      // rotation while the CLI install is in flight.
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onClick={() => {
        if (!disabled) {
          onSelect();
        }
      }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function menuItems(menu: HTMLDivElement | null) {
  return Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
}
