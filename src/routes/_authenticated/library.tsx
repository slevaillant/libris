import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/library")({
  component: Library,
});

function Library() {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
          <h1 className="text-xs font-medium">Library</h1>
        </div>
        <Button size="sm" variant="outline" disabled>
          <Plus className="h-3 w-3" />
          Add source
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center space-y-3 max-w-xs">
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-card border border-border">
              <BookOpen className="h-6 w-6 text-muted-foreground" />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium">Your library is empty</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add physical books, e-books, Substacks, or GitHub repos
              to start building your knowledge base.
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            Book ingestion coming in Phase 3.
          </p>
        </div>
      </div>
    </div>
  );
}
