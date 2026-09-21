import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  CaretUpDown,
  ChatCircleText,
  FolderOpen,
  GearSix,
  Lifebuoy,
  Plus,
  SignOut,
  User,
  X,
} from "@phosphor-icons/react";

import { useAuth } from "@/hooks/use-auth";
import { useChats } from "@/hooks/use-chats";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabId = "chat" | "space";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chat", icon: ChatCircleText },
  { id: "space", label: "Space", icon: FolderOpen },
];

/** Which tab a route belongs to; settings and help belong to neither. */
function tabForPath(pathname: string): TabId | undefined {
  if (pathname === "/") return "space";
  if (pathname.startsWith("/chat")) return "chat";
  return undefined;
}

/** The Chat tab: a new-chat button and every saved chat, newest first. */
function ChatList({ pathname }: { pathname: string }) {
  const { chats, remove } = useChats();
  const navigate = useNavigate();
  const isNew = pathname === "/chat";

  function onRemove(id: string) {
    remove(id);
    if (pathname === `/chat/${id}`) navigate("/chat", { replace: true });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isNew} tooltip="New chat">
          <Link to="/chat">
            <Plus weight="bold" />
            <span>New chat</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {chats.map((chat) => {
        const isActive = pathname === `/chat/${chat.id}`;
        return (
          <SidebarMenuItem key={chat.id}>
            <SidebarMenuButton asChild isActive={isActive} tooltip={chat.title}>
              <Link to={`/chat/${chat.id}`}>
                <ChatCircleText
                  weight={isActive ? "fill" : "bold"}
                  className="hidden group-data-[collapsible=icon]:block"
                />
                <span className="truncate">{chat.title}</span>
              </Link>
            </SidebarMenuButton>
            <SidebarMenuAction showOnHover aria-label={`Delete ${chat.title}`} onClick={() => onRemove(chat.id)}>
              <X weight="bold" />
            </SidebarMenuAction>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/** The Space tab: the workspace and, later, what lives in it. */
function SpaceList({ pathname }: { pathname: string }) {
  const isActive = pathname === "/";
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isActive} tooltip="Workspace">
          <Link to="/">
            <FolderOpen weight={isActive ? "fill" : "bold"} />
            <span>Workspace</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function Brand() {
  const { info } = useAuth();
  return (
    <div className="flex h-8 items-center gap-2.5 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <span className="size-2.5 shrink-0 rotate-45 rounded-[2px] bg-black" aria-hidden="true" />
      <span className="truncate text-lead text-foreground group-data-[collapsible=icon]:hidden">
        {info?.name ?? "Photon"}
      </span>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  if (!user) return null;

  const name = user.first_name ? `${user.first_name} ${user.last_name}`.trim() : user.email;
  const initials = (user.first_name?.[0] ?? user.email[0] ?? "?").toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" tooltip={name} className="data-[state=open]:bg-sidebar-accent">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sheet font-mono text-small text-foreground">
            {initials}
          </span>
          <span className="grid flex-1 text-left leading-tight">
            <span className="truncate text-body font-medium">{name}</span>
            <span className="truncate text-small text-slate">{user.email}</span>
          </span>
          <CaretUpDown className="ml-auto size-4 text-slate" weight="bold" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" sideOffset={8} className="w-56 rounded-lg">
        <DropdownMenuLabel className="font-normal">
          <div className="grid leading-tight">
            <span className="text-body font-medium">{name}</span>
            <span className="text-small text-slate">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings/account")}>
          <User weight="bold" />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <GearSix weight="bold" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/help")}>
          <Lifebuoy weight="bold" />
          Help and shortcuts
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
          <SignOut weight="bold" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation();
  const navigate = useNavigate();

  // The active tab follows the route; on settings or help it keeps the last pick.
  const routeTab = tabForPath(location.pathname);
  const [pickedTab, setPickedTab] = React.useState<TabId>(routeTab ?? "chat");
  const activeTab = routeTab ?? pickedTab;

  const onTabChange = (value: string) => {
    const tab = value as TabId;
    setPickedTab(tab);
    navigate(tab === "chat" ? "/chat" : "/");
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="pt-3">
        <Brand />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            <Tabs value={activeTab} onValueChange={onTabChange} className="group-data-[collapsible=icon]:hidden">
              <TabsList className="w-full">
                {TABS.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id}>
                    <tab.icon weight={activeTab === tab.id ? "fill" : "bold"} />
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {activeTab === "chat" ? (
              <ChatList pathname={location.pathname} />
            ) : (
              <SpaceList pathname={location.pathname} />
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
