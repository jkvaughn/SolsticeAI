import * as React from "react";
import { cn } from "./utils";

interface CodaButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'default' | 'success' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const CodaButton = React.forwardRef<HTMLButtonElement, CodaButtonProps>(
  ({ className, variant = 'default', size = 'md', children, disabled, ...props }, ref) => {
    const baseStyles =
      "flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed";

    const sizeStyles = {
      sm: "h-9 px-4 text-sm",
      md: "h-11 px-6",
      lg: "h-12 px-8",
    };

    const variantStyles = {
      primary: "bg-transparent text-coda-text",
      default: "bg-transparent text-coda-text",
      success: "bg-transparent text-coda-text",
      danger: "bg-red-500/15 text-red-400",
      ghost: "bg-transparent text-coda-text",
    };

    return (
      <button
        ref={ref}
        className={cn(
          baseStyles,
          sizeStyles[size],
          variantStyles[variant],
          className,
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  },
);
CodaButton.displayName = "CodaButton";