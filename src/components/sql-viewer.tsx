"use client";

import { useMemo, useState } from "react";
import { format as formatSql } from "sql-formatter";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

const KEYWORDS =
  /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|FROM|WHERE|INTO|VALUES|SET|AND|OR|NOT|NULL|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|DEFAULT|AUTOINCREMENT|INTEGER|TEXT|REAL|BLOB|NUMERIC|IF|EXISTS|JOIN|LEFT|INNER|ON|AS|ORDER|BY|GROUP|LIMIT|COUNT|DISTINCT|PRAGMA|BEGIN|COMMIT|ROLLBACK|ADD|COLUMN|CASCADE)\b/gi;

function highlight(sql: string) {
  const escaped = sql
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/('(?:[^']|'')*')/g, '<span class="text-emerald-500">$1</span>')
    .replace(/(--.*$)/gm, '<span class="text-muted-foreground italic">$1</span>')
    .replace(KEYWORDS, '<span class="text-primary font-semibold">$&</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="text-amber-500">$1</span>');
}

export function SqlViewer({
  sql,
  className,
  title,
}: {
  sql: string;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => {
    try {
      return formatSql(sql, { language: "sqlite", keywordCase: "upper" });
    } catch {
      return sql;
    }
  }, [sql]);

  return (
    <div className={cn("group relative overflow-hidden rounded-md border bg-muted/40", className)}>
      {title && (
        <div className="border-b bg-muted/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
      )}
      <button
        onClick={() => {
          navigator.clipboard.writeText(pretty);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
        className="absolute right-2 top-2 z-10 rounded-md border bg-background/80 p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Copy SQL"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="scrollbar-thin overflow-x-auto p-3 text-xs leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: highlight(pretty) }} />
      </pre>
    </div>
  );
}
