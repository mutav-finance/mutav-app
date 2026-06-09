"use client";

import { cn } from "@mutav/ui/cn";
import { Avatar, AvatarFallback, AvatarImage } from "@mutav/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@mutav/ui/dropdown-menu";
import { useIsMobile } from "@mutav/ui/use-mobile";
import {
  EllipsisVerticalIcon,
  CircleUserRoundIcon,
  BellIcon,
  LogOutIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  LanguagesIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@mutav/i18n/navigation";
import { routing } from "@mutav/i18n/routing";

const LOCALE_LABELS: Record<(typeof routing.locales)[number], string> = {
  "pt-BR": "Português",
  en: "English",
};

// Reproduces the visual contract of <SidebarMenuButton size="lg" /> so this
// component can live in @mutav/ui without depending on each app's local
// sidebar.tsx. The class string mirrors `sidebarMenuButtonVariants({ size: "lg" })`
// + the `data-[state=open]:bg-sidebar-accent ...` open-state hint the trigger
// uses. The `group-data-[collapsible=icon]:*` selectors target the ancestor
// `<Sidebar>` wrapper, so the icon-collapsed treatment still works.
const TRIGGER_CLASS =
  "peer/menu-button group/menu-button ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:font-medium [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate h-12 group-data-[collapsible=icon]:p-0!";

export type NavUserProps = {
  user: {
    name: string;
    email: string;
    avatar?: string;
  };
  /**
   * URL the log-out item navigates to. Defaults to `/auth/logout` (Auth0 SDK
   * convention). The link is a plain `<a>` so the proxy middleware clears
   * the session cookie — client-side routing would skip it.
   */
  logoutHref?: string;
};

export function NavUser({ user, logoutHref = "/auth/logout" }: NavUserProps) {
  const isMobile = useIsMobile();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const ThemeTriggerIcon = resolvedTheme === "dark" ? MoonIcon : SunIcon;
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("userMenu");
  const switchLocale = (next: string) => {
    router.replace(pathname, { locale: next as (typeof routing.locales)[number] });
  };

  const initials = user.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <ul data-slot="sidebar-menu" data-sidebar="menu" className="flex w-full min-w-0 flex-col gap-0">
      <li
        data-slot="sidebar-menu-item"
        data-sidebar="menu-item"
        className="group/menu-item relative"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-slot="sidebar-menu-button"
              data-sidebar="menu-button"
              data-size="lg"
              className={cn(TRIGGER_CLASS)}
            >
              <Avatar>
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="text-muted-foreground truncate text-xs">{user.email}</span>
              </div>
              <EllipsisVerticalIcon className="ml-auto size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar>
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <CircleUserRoundIcon />
                {t("account")}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <BellIcon />
                {t("notifications")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ThemeTriggerIcon />
                {t("theme")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                  <DropdownMenuRadioItem value="light">
                    <SunIcon />
                    {t("themeLight")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <MoonIcon />
                    {t("themeDark")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <MonitorIcon />
                    {t("themeSystem")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <LanguagesIcon />
                {t("language")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={locale} onValueChange={switchLocale}>
                  {routing.locales.map((l) => (
                    <DropdownMenuRadioItem key={l} value={l}>
                      {LOCALE_LABELS[l]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={logoutHref}>
                <LogOutIcon />
                {t("logOut")}
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    </ul>
  );
}
