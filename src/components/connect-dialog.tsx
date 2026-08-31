"use client";

import { useEffect, useState } from "react";
import { Database, FilePlus2, HardDrive, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button, Input } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { jsonFetch } from "@/lib/client-api";
import { formatBytes, relativeTime } from "@/lib/utils";

interface FileEntry {
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export function ConnectDialog({
  trigger,
  onConnected,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  onConnected: (databaseId: string) => void;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (v: boolean) => {
    setUncontrolledOpen(v);
    onOpenChange?.(v);
  };
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [root, setRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [manualPath, setManualPath] = useState("");

  useEffect(() => {
    if (!open) return;
    jsonFetch<{ root: string; files: FileEntry[] }>("/api/databases/files")
      .then((r) => {
        setFiles(r.files);
        setRoot(r.root);
      })
      .catch((e) => setError(String(e)));
  }, [open]);

  async function connect(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const r = await jsonFetch<{ database: { id: string } }>("/api/databases", {
        method: "POST",
        body: JSON.stringify(body),
      });
      onConnected(r.database.id);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" /> Connect a SQLite database
          </DialogTitle>
          <DialogDescription>
            Files are read from the sandbox root <code className="font-mono">{root}</code>. Paths
            outside it are rejected.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="pick">
          <TabsList className="w-full">
            <TabsTrigger value="pick" className="flex-1">
              <HardDrive className="h-3.5 w-3.5" /> Pick existing
            </TabsTrigger>
            <TabsTrigger value="create" className="flex-1">
              <FilePlus2 className="h-3.5 w-3.5" /> Create new
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pick" className="mt-3 space-y-2">
            <div className="scrollbar-thin max-h-60 space-y-1 overflow-y-auto">
              {files.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No .db / .sqlite files in the root yet. Run <code>npm run seed</code> or create one.
                </p>
              )}
              {files.map((f) => (
                <button
                  key={f.relativePath}
                  disabled={busy}
                  onClick={() => connect({ mode: "open", path: f.relativePath })}
                  className="flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm hover:bg-accent/60"
                >
                  <Database className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium">{f.relativePath}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {formatBytes(f.sizeBytes)} · {relativeTime(f.modifiedAt)}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="…or a relative path e.g. sub/dir/app.db"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
              />
              <Button
                variant="secondary"
                disabled={busy || !manualPath}
                onClick={() => connect({ mode: "open", path: manualPath })}
              >
                Open
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="create" className="mt-3 space-y-2">
            <label className="text-xs font-medium">Database name</label>
            <div className="flex gap-2">
              <Input
                placeholder="my_project"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button
                disabled={busy || !newName}
                onClick={() => connect({ mode: "create", name: newName })}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Creates <code className="font-mono">{root}/{newName.replace(/\s+/g, "_").toLowerCase() || "name"}.db</code>
            </p>
          </TabsContent>
        </Tabs>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
