import * as React from "react";
import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import {
  Broom,
  CaretUpDown,
  ChatCircleText,
  DotsThree,
  DownloadSimple,
  FolderOpen,
  GearSix,
  Lifebuoy,
  PencilSimple,
  Plus,
  SignOut,
  Trash,
  User,
} from "@phosphor-icons/react";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";
import { useChats, type Chat } from "@/hooks/use-chats";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/utils";
import { chatToMarkdown, exportFilename } from "@/lib/export-chat";
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
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarResizeHandle,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputField } from "@/components/form-fields";

type TabId = "chat" | "space";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chat", icon: ChatCircleText },
  { id: "space", label: "Space", icon: FolderOpen },
];

/** Which tab a route belongs to; settings and help belong to neither. */
function tabForPath(pathname: string, chatSpace: (id: string) => string | undefined): TabId | undefined {
  if (pathname === "/" || pathname.startsWith("/space")) return "space";
  const m = matchPath("/chat/:chatId", pathname);
  if (m?.params.chatId) return chatSpace(m.params.chatId) ? "space" : "chat";
  if (pathname.startsWith("/chat")) return "chat";
  return undefined;
}

function RenameDialog({
  open,
  onOpenChange,
  chat,
  onRename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chat: Chat;
  onRename: (title: string) => void;
}) {
  const [title, setTitle] = React.useState(chat.title);
  // Start from the current title each time the dialog opens.
  React.useEffect(() => {
    if (open) setTitle(chat.title);
  }, [open, chat.title]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            onRename(title);
            onOpenChange(false);
          }}
        >
          <div className="grid gap-2">
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Leave it empty to go back to naming it after the first message.</DialogDescription>
          </div>
          <InputField name="chat_title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChatRow({ chat, pathname, onRemove }: { chat: Chat; pathname: string; onRemove: (id: string) => void }) {
  const { clear, rename } = useChats();
  const { isMobile } = useSidebar();
  const { toast } = useToast();
  const { user } = useAuth();

  // Everything the transcript shows, tool calls and their output included, as one .md file.
  async function exportChat() {
    try {
      const content = chatToMarkdown(chat, { exportedBy: user?.email });
      const path = await window.photon.saveTextFile({ defaultName: exportFilename(chat), content });
      if (path) toast(`Saved to ${path}`);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }
  const isActive = pathname === `/chat/${chat.id}`;
  const [renaming, setRenaming] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={chat.title}>
        <Link to={`/chat/${chat.id}`}>
          <ChatCircleText weight={isActive ? "fill" : "bold"} className="hidden group-data-[collapsible=icon]:block" />
          <span className="truncate">{chat.title}</span>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`Actions for ${chat.title}`} className="data-[state=open]:opacity-100">
            <DotsThree weight="bold" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="start" className="w-44">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PencilSimple weight="bold" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportChat()} disabled={!chat.turns.length}>
            <DownloadSimple weight="bold" />
            Export as Markdown
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => clear(chat.id)} disabled={!chat.turns.length}>
            <Broom weight="bold" />
            Clear messages
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash weight="bold" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameDialog open={renaming} onOpenChange={setRenaming} chat={chat} onRename={(t) => rename(chat.id, t)} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this chat?"
        description={
          <>
            <span className="text-foreground">{chat.title}</span> and its{" "}
            {chat.turns.length === 1 ? "message" : `${chat.turns.length} messages`} will be gone. This cannot be undone.
          </>
        }
        onConfirm={() => onRemove(chat.id)}
      />
    </SidebarMenuItem>
  );
}

function NewChatRow({ to, active }: { to: string; active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip="New chat">
        <Link to={to}>
          <Plus weight="bold" />
          <span>New chat</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Picks a folder, makes it the active space and opens a fresh chat in it. */
function NewSpaceRow({ onOpened }: { onOpened: () => void }) {
  const { call } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);

  async function pick() {
    setBusy(true);
    try {
      const ws = await call((t) => window.photon.openWorkspace(t));
      if (!ws) return;
      toast(`Now working in ${ws.name}`);
      onOpened();
      navigate("/space/chat");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="New space" onClick={() => void pick()} disabled={busy}>
        <Plus weight="bold" />
        <span>New space</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Deletes a chat and leaves its page if it is open. */
function useRemoveChat(pathname: string, fallback: string) {
  const { remove } = useChats();
  const navigate = useNavigate();
  return (id: string) => {
    remove(id);
    if (pathname === `/chat/${id}`) navigate(fallback, { replace: true });
  };
}

/** The Chat tab: a new-chat button and every free-standing chat, newest first. */
function ChatList({ pathname }: { pathname: string }) {
  const { chats } = useChats();
  const onRemove = useRemoveChat(pathname, "/chat");
  return (
    <SidebarMenu>
      <NewChatRow to="/chat" active={pathname === "/chat"} />
      {chats
        .filter((c) => !c.spaceId)
        .map((chat) => (
          <ChatRow key={chat.id} chat={chat} pathname={pathname} onRemove={onRemove} />
        ))}
    </SidebarMenu>
  );
}

/** The Space tab: a new-space button, then each workspace with the chats that run in it. */
function SpaceList({ pathname }: { pathname: string }) {
  const { call, user } = useAuth();
  const { chats } = useChats();
  const workspaces = useAsync(() => call((t) => window.photon.listWorkspaces(t)), [user?.id]);
  const onRemove = useRemoveChat(pathname, "/space/chat");

  return (
    <>
      <SidebarMenu>
        <NewSpaceRow onOpened={workspaces.reload} />
      </SidebarMenu>
      {workspaces.data?.map((ws) => {
        const own = chats.filter((c) => c.spaceId === ws.id);
        const newActive = pathname === `/space/${ws.id}/chat`;
        return (
          <SidebarGroup key={ws.id} className="p-0 pt-2 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="h-6 gap-1.5 px-2 font-mono text-small" title={ws.root_path}>
              <FolderOpen weight="bold" className="size-3.5 shrink-0" />
              <span className="truncate">{ws.name}</span>
            </SidebarGroupLabel>
            <SidebarGroupAction asChild className="top-2.5 right-1" title={`New chat in ${ws.name}`}>
              <Link to={`/space/${ws.id}/chat`} aria-label={`New chat in ${ws.name}`} aria-current={newActive ? "page" : undefined}>
                <Plus weight="bold" />
              </Link>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {own.map((chat) => (
                  <ChatRow key={chat.id} chat={chat} pathname={pathname} onRemove={onRemove} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}
    </>
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

  const { get } = useChats();
  // The active tab follows the route; on settings or help it keeps the last pick.
  const routeTab = tabForPath(location.pathname, (id) => get(id)?.spaceId);
  const [pickedTab, setPickedTab] = React.useState<TabId>(routeTab ?? "chat");
  const activeTab = routeTab ?? pickedTab;

  const onTabChange = (value: string) => {
    const tab = value as TabId;
    setPickedTab(tab);
    navigate(tab === "chat" ? "/chat" : "/space/chat");
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
      <SidebarResizeHandle />
    </Sidebar>
  );
}
