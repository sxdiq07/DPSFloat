"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { MessageCircle, Send, Trash2, Bell, Sparkles } from "lucide-react";
import { addNote, deleteNote } from "../_actions/notes";

export type TimelineEvent = {
  key: string;
  kind: "note" | "reminder" | "promise";
  at: string;
  title: React.ReactNode;
  body?: React.ReactNode;
  authorName?: string;
  noteId?: string;
  canDelete?: boolean;
};

export function NotesTimeline({
  clientCompanyId,
  events,
}: {
  clientCompanyId: string;
  events: TimelineEvent[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startPending] = useTransition();

  const onAdd = () => {
    const text = body.trim();
    if (!text) return;
    startPending(async () => {
      const res = await addNote({ clientCompanyId, body: text });
      if (res.ok) {
        toast.success("Note added");
        setBody("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const onDelete = (noteId: string) => {
    if (!confirm("Delete this note?")) return;
    startPending(async () => {
      const res = await deleteNote(noteId);
      if (res.ok) {
        toast.success("Note deleted");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <section className="card-apple overflow-hidden">
      <div className="px-8 pt-7 pb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
          Activity
        </p>
        <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
          Timeline
        </h2>
        <p className="mt-1 text-[14px] text-ink-3">
          Every note, reminder, and promise — in one thread.
        </p>
      </div>

      {/* Composer */}
      <div className="border-t border-subtle bg-[var(--color-surface-2)]/30 px-8 py-5">
        <div className="flex gap-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note · what you learned, promised, decided…"
            rows={2}
            className="flex-1 rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-4 py-2.5 text-[14.5px] text-ink outline-none transition-all placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={pending || !body.trim()}
            className="btn-apple h-10 shrink-0 gap-1.5 self-start px-4 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Post
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="border-t border-subtle">
        {events.length === 0 ? (
          <div className="px-8 py-16 text-center">
            <p className="text-[15px] font-medium text-ink">No activity yet</p>
            <p className="mt-1 text-[13px] text-ink-3">
              Notes, reminders and promises all flow here once they happen.
            </p>
          </div>
        ) : (
          <ol className="relative py-4">
            {events.map((e, i) => (
              <li
                key={e.key}
                className="group relative px-8 py-3.5 hover:bg-[var(--color-surface-2)]/40"
              >
                <div className="flex gap-4">
                  <div className="relative shrink-0">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white"
                      style={{
                        background:
                          e.kind === "note"
                            ? "linear-gradient(135deg, #0a84ff, #5e5ce6)"
                            : e.kind === "reminder"
                              ? "linear-gradient(135deg, #30d158, #34c7b8)"
                              : "linear-gradient(135deg, #ff9f0a, #ff6b3d)",
                      }}
                      aria-hidden
                    >
                      {e.kind === "note" ? (
                        <MessageCircle className="h-3.5 w-3.5" />
                      ) : e.kind === "reminder" ? (
                        <Bell className="h-3.5 w-3.5" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                    </div>
                    {i < events.length - 1 && (
                      <div
                        aria-hidden
                        className="absolute left-1/2 top-9 h-[calc(100%_+_12px)] w-px -translate-x-1/2"
                        style={{ background: "var(--color-border-subtle)" }}
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-[14.5px] text-ink">{e.title}</div>
                      <div className="shrink-0 text-[11.5px] text-ink-3">
                        {formatDistanceToNow(new Date(e.at), {
                          addSuffix: true,
                        })}
                      </div>
                    </div>
                    {e.body && (
                      <div className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">
                        {e.body}
                      </div>
                    )}
                    {e.authorName && (
                      <div className="mt-1 text-[11.5px] text-ink-3">
                        by {e.authorName}
                      </div>
                    )}
                  </div>

                  {e.canDelete && e.noteId && (
                    <button
                      type="button"
                      onClick={() => onDelete(e.noteId!)}
                      disabled={pending}
                      className="h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-3 opacity-0 transition-all hover:bg-[rgba(255,69,58,0.08)] hover:text-[#c6373a] group-hover:flex disabled:opacity-30"
                      aria-label="Delete note"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
