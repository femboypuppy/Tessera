import { TAG_COLORS, USER_COLORS } from '@tessera/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Callout,
  Checkbox,
  ColorSwatches,
  confirm,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  COVER_PRESETS,
  coverPresetBackground,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmojiPicker,
  EmptyState,
  FeatureBoundary,
  Field,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  IconButton,
  Input,
  Kbd,
  KeyCombo,
  Label,
  Panel,
  PanelBody,
  PanelHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioCard,
  RadioGroup,
  ScrollArea,
  Select,
  Separator,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarRoot,
  SidebarSection,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  Tooltip,
} from '@tessera/ui';
import {
  Bell,
  Copy,
  FileText,
  Inbox,
  Moon,
  Plus,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { applyTheme } from '../theme';

function Specimen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-bg p-5">
      <h2 className="mb-4 font-mono text-xs font-medium tracking-wide text-fg-subtle uppercase">
        {title}
      </h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

function Crash(): ReactNode {
  throw new Error('This component crashed on purpose (dev gallery).');
}

/**
 * `/dev/ui`: every `@tessera/ui` component in its states, for visual checks in both themes. Not
 * linked from the app; strings here are fixture text, not product copy.
 */
export function DevUiView() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(false);
  const [radio, setRadio] = useState('system');
  const [color, setColor] = useState<string>(USER_COLORS[5]);
  const [emoji, setEmoji] = useState('🪐');
  const [crash, setCrash] = useState(false);
  const toggleTheme = () => {
    applyTheme(dark ? 'light' : 'dark');
    setDark(!dark);
  };
  return (
    <main className="min-h-dvh bg-bg-subtle px-4 py-8 text-fg md:px-10">
      <header className="mx-auto mb-8 flex max-w-6xl items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">@tessera/ui</h1>
          <p className="text-ui text-fg-muted">Component gallery for visual checks.</p>
        </div>
        <Button onClick={toggleTheme}>
          {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          {dark ? 'Light theme' : 'Dark theme'}
        </Button>
      </header>
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-2">
        <Specimen title="Button">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg" variant="primary">
            <Plus aria-hidden="true" />
            Large
          </Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </Specimen>
        <Specimen title="IconButton and Tooltip">
          <IconButton label="New page" icon={<Plus />} shortcut={['⌘', 'N']} />
          <IconButton label="Search" icon={<Search />} size="lg" />
          <IconButton label="Favorite" icon={<Star />} aria-pressed />
          <IconButton label="Settings" icon={<Settings />} size="sm" />
          <Tooltip content="A tooltip">
            <Button size="sm">Hover me</Button>
          </Tooltip>
        </Specimen>
        <Specimen title="Input, Textarea, Field, Select">
          <div className="flex w-full flex-col gap-3">
            <Input placeholder="Search pages" />
            <Field label="Display name" description="Shown to collaborators.">
              {(props) => <Input {...props} defaultValue="Ada Lovelace" />}
            </Field>
            <Field label="With an error" error="This field is required.">
              {(props) => <Input {...props} />}
            </Field>
            <Textarea placeholder="Write something…" />
            <Select
              aria-label="Theme"
              value={radio}
              onValueChange={setRadio}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
            />
          </div>
        </Specimen>
        <Specimen title="Checkbox, Switch, RadioGroup, ColorSwatches">
          <div className="flex items-center gap-2">
            <Checkbox
              id="dev-checkbox"
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            <Label htmlFor="dev-checkbox">Checkbox</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="dev-indeterminate" checked="indeterminate" />
            <Label htmlFor="dev-indeterminate">Indeterminate</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="dev-switch" checked={on} onCheckedChange={setOn} />
            <Label htmlFor="dev-switch">Switch</Label>
          </div>
          <RadioGroup value={radio} onValueChange={setRadio} className="w-full" aria-label="Theme">
            <RadioCard value="light" label="Light" icon={<Sun />} />
            <RadioCard value="dark" label="Dark" icon={<Moon />} />
            <RadioCard value="system" label="System" description="Follows your device" />
          </RadioGroup>
          <ColorSwatches label="Color" colors={USER_COLORS} value={color} onChange={setColor} />
        </Specimen>
        <Specimen title="Dialog and AlertDialog">
          <Dialog>
            <DialogTrigger asChild>
              <Button>Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename workspace</DialogTitle>
                <DialogDescription>Workspace names appear in the switcher.</DialogDescription>
              </DialogHeader>
              <DialogBody>
                <Input defaultValue="Apollo research" aria-label="Workspace name" />
              </DialogBody>
              <DialogFooter>
                <Button variant="primary">Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="danger">Delete forever</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Delete “Launch plan” forever?</AlertDialogTitle>
              <AlertDialogDescription>This can’t be undone.</AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction destructive>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            onClick={() =>
              void confirm({
                title: 'Empty the trash?',
                destructive: true,
                confirmLabel: 'Empty trash',
              })
            }
          >
            confirm()
          </Button>
        </Specimen>
        <Specimen title="DropdownMenu and ContextMenu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Page</DropdownMenuLabel>
              <DropdownMenuItem icon={<Copy />} shortcut={['⌘', 'D']}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked>Full width</DropdownMenuCheckboxItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<FileText />}>Turn into</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Heading 1</DropdownMenuItem>
                  <DropdownMenuItem>Quote</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 />} destructive>
                Move to trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ContextMenu>
            <ContextMenuTrigger className="rounded-md border border-dashed border-border-strong px-4 py-2 text-ui text-fg-muted">
              Right-click here
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem icon={<Star />}>Add to favorites</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem icon={<Trash2 />} destructive>
                Move to trash
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </Specimen>
        <Specimen title="Popover, HoverCard, EmojiPicker">
          <Popover>
            <PopoverTrigger asChild>
              <Button>
                <span aria-hidden="true">{emoji}</span> Pick an emoji
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0">
              <EmojiPicker onSelect={setEmoji} onRemove={() => setEmoji('📄')} />
            </PopoverContent>
          </Popover>
          <HoverCard>
            <HoverCardTrigger asChild>
              <Button variant="link">Hover for a preview</Button>
            </HoverCardTrigger>
            <HoverCardContent>
              <p className="text-sm font-medium">Apollo 11</p>
              <p className="mt-1 text-ui text-fg-muted">
                The first crewed Moon landing, July 1969.
              </p>
            </HoverCardContent>
          </HoverCard>
        </Specimen>
        <Specimen title="Tabs and ScrollArea">
          <Tabs defaultValue="one" className="w-full">
            <TabsList>
              <TabsTrigger value="one">Table</TabsTrigger>
              <TabsTrigger value="two">Board</TabsTrigger>
            </TabsList>
            <TabsContent value="one" className="pt-3 text-ui text-fg-muted">
              Table view content.
            </TabsContent>
            <TabsContent value="two" className="pt-3 text-ui text-fg-muted">
              Board view content.
            </TabsContent>
          </Tabs>
          <ScrollArea className="h-28 w-full rounded-md border border-border">
            <ul className="p-3 text-ui">
              {Array.from({ length: 20 }, (_, index) => (
                <li key={index}>Mission log entry {index + 1}</li>
              ))}
            </ul>
          </ScrollArea>
        </Specimen>
        <Specimen title="Toast and Callout">
          <Button
            onClick={() =>
              toast({
                title: 'Moved “Launch plan” to the trash',
                action: { label: 'Undo', onClick: () => undefined },
              })
            }
          >
            Toast
          </Button>
          <Button onClick={() => toast({ title: 'Synced', variant: 'success' })}>Success</Button>
          <Button
            onClick={() =>
              toast({
                title: 'Changes could not be saved',
                description: 'Storage is full.',
                variant: 'error',
              })
            }
          >
            Error
          </Button>
          <Callout tone="info" title="Heads up">
            Everything is saved as you type.
          </Callout>
          <Callout tone="warning">This workspace is in a cloud-synced folder.</Callout>
        </Specimen>
        <Specimen title="Kbd, Spinner, Skeleton, Badge, Avatar, Separator">
          <Kbd>Esc</Kbd>
          <KeyCombo keys={['⌘', '⇧', 'L']} />
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
          <div className="flex w-full flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          {TAG_COLORS.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
          <Badge tone="accent">accent</Badge>
          <Badge tone="danger">danger</Badge>
          <Avatar name="Ada Lovelace" color={USER_COLORS[0]} />
          <Avatar name="Grace Hopper" color={USER_COLORS[6]} size="lg" />
          <AvatarStack
            people={USER_COLORS.map((c, index) => ({
              id: String(index),
              name: `Person ${index + 1}`,
              color: c,
            }))}
            max={4}
          />
          <Separator />
        </Specimen>
        <Specimen title="EmptyState and FeatureBoundary">
          <EmptyState
            icon={<Inbox />}
            title="The trash is empty"
            description="Deleted pages appear here."
            actions={<Button size="sm">Go back</Button>}
          />
          <div className="w-full">
            <FeatureBoundary featureId="demo" resetKeys={[crash]}>
              {crash ? <Crash /> : <Button onClick={() => setCrash(true)}>Crash a feature</Button>}
            </FeatureBoundary>
          </div>
        </Specimen>
        <Specimen title="Sidebar and Panel primitives">
          <div className="flex h-72 w-full overflow-hidden rounded-lg border border-border">
            <div className="w-56 border-r border-border">
              <SidebarRoot aria-label="Demo sidebar">
                <SidebarHeader>
                  <SidebarItem icon={<Search />} label="Search" shortcut={['⌘', 'K']} />
                </SidebarHeader>
                <SidebarContent>
                  <SidebarSection title="Favorites" collapsible>
                    <SidebarItem icon={<FileText />} label="Launch plan" active />
                    <SidebarItem icon={<FileText />} label="Reading list" />
                  </SidebarSection>
                </SidebarContent>
                <SidebarFooter>
                  <SidebarItem icon={<Trash2 />} label="Trash" />
                </SidebarFooter>
              </SidebarRoot>
            </div>
            <Panel className="flex-1">
              <PanelHeader title="Backlinks" icon={<Bell />} onClose={() => undefined} />
              <PanelBody className="text-ui text-fg-muted">Panel content.</PanelBody>
            </Panel>
          </div>
        </Specimen>
        <Specimen title="Cover presets">
          {Object.keys(COVER_PRESETS).map((name) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <div
                className="h-12 w-24 rounded-md"
                style={{ background: coverPresetBackground(name) }}
              />
              <span className="font-mono text-2xs text-fg-subtle">{name}</span>
            </div>
          ))}
        </Specimen>
      </div>
    </main>
  );
}
