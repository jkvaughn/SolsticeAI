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
      "rounded-full transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed";

    const sizeStyles = {
      sm: "h-9 px-4 text-sm",
      md: "h-11 px-6",
      lg: "h-12 px-8",
    };

    const variantStyles = {
      primary: "bg-blue-500 hover:bg-blue-600 text-white",
      default:
        "bg-black/10 dark:bg-white/10 hover:bg-black hover:dark:bg-white text-black dark:text-white hover:text-white hover:dark:text-black",
      success: "bg-green-600 hover:bg-green-700 text-white",
      danger: "bg-red-600 hover:bg-red-700 text-white",
      ghost:
        "bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-black dark:text-white",
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