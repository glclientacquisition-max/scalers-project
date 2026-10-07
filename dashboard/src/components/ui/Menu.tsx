"use client";

import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cx } from "@/lib/cx";

const popupClass =
  "glass-chrome z-menu min-w-48 origin-[var(--transform-origin)] rounded-xl border border-hairline py-1.5 text-body text-ink shadow-menu outline-none transition-[opacity,transform] duration-fast ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none";

const itemClass =
  "flex min-h-11 cursor-default select-none items-center gap-3 px-3 outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50 [&>svg]:h-5 [&>svg]:w-5 [&>svg]:text-ink-2";

/**
 * Overflow and account menus. Arrow keys, typeahead, Escape, and outside-press come from Base UI.
 * `trigger` is the button element; it receives the aria wiring.
 */
export function Menu({
  trigger,
  children,
  side = "bottom",
  align = "end",
  open,
  onOpenChange,
  popupClassName,
}: {
  trigger: ReactElement;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  popupClassName?: string;
}) {
  const { className, children: triggerChildren, type: _type, ...triggerProps } = trigger.props as {
    className?: string;
    children?: ReactNode;
    type?: string;
  } & Record<string, unknown>;
  return (
    <BaseMenu.Root {...(typeof open === "boolean" ? { open } : {})} onOpenChange={onOpenChange}>
      <BaseMenu.Trigger className={className} {...triggerProps}>
        {triggerChildren}
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner side={side} align={align} sideOffset={6} collisionPadding={12} className="z-menu">
          <BaseMenu.Popup className={cx(popupClass, popupClassName)}>{children}</BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export function MenuItem({
  className,
  tone = "neutral",
  ...rest
}: ComponentProps<typeof BaseMenu.Item> & { tone?: "neutral" | "attention" }) {
  return (
    <BaseMenu.Item
      className={cx(itemClass, tone === "attention" && "text-attention [&>svg]:text-attention", className as string)}
      {...rest}
    />
  );
}

export function MenuLinkItem({ className, ...rest }: ComponentProps<typeof BaseMenu.LinkItem>) {
  return <BaseMenu.LinkItem className={cx(itemClass, className as string)} {...rest} />;
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="my-1.5 h-px bg-hairline" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <BaseMenu.GroupLabel className="px-3 pb-1 pt-2 text-caption font-medium uppercase tracking-wide text-ink-3">
      {children}
    </BaseMenu.GroupLabel>
  );
}

export const MenuGroup = BaseMenu.Group;
