import * as React from "react";

import { cn } from "./utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "liquid-glass-subtle text-coda-text placeholder:text-[#86868b] dark:placeholder:text-[#a0a0a5] resize-none focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full squircle-lg px-3 py-2 text-base transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm relative z-10",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
