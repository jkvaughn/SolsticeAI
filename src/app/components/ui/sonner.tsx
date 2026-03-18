"use client";

import { useTheme } from "../ThemeProvider";
import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme();
  const theme = resolved as ToasterProps["theme"];

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      expand={false}
      richColors={false}
      closeButton={false}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast: 'glass-toast-custom',
        },
        style: {
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          background: 'rgba(255, 255, 255, 0.2)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };