"use client";

import { useState } from "react";

import { FileUp, Loader2 } from "lucide-react";

import { cn } from "@louez/utils";

interface FileDropzoneProps {
  accept: string;
  title: string;
  hint: string;
  busyLabel: string;
  isBusy: boolean;
  onFile: (file: File) => void;
  className?: string;
}

/** A drop target for one file, with the three states of the product image tile: idle, hovered, busy. */
export const FileDropzone = ({
  accept,
  title,
  hint,
  busyLabel,
  isBusy,
  onFile,
  className,
}: FileDropzoneProps) => {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <label
      className={cn(
        "group/drop flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
        isBusy
          ? "border-primary/40 bg-primary/5 cursor-wait"
          : isDragging
            ? "border-primary bg-primary/5"
            : "border-input bg-background hover:border-muted-foreground/40 hover:bg-accent/50",
        className,
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files[0];
        if (file && !isBusy) onFile(file);
      }}
    >
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-full border transition-colors",
          isDragging
            ? "border-primary/30 bg-primary/10"
            : "bg-muted group-hover/drop:bg-background group-hover/drop:border-border border-transparent",
        )}
      >
        {isBusy ? (
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        ) : (
          <FileUp className={cn("size-5", isDragging ? "text-primary" : "text-muted-foreground")} />
        )}
      </span>
      <span className="text-sm font-medium">{isBusy ? busyLabel : title}</span>
      {!isBusy && <span className="text-muted-foreground text-xs">{hint}</span>}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        disabled={isBusy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </label>
  );
};
