import * as React from "react";
import { motion } from "../motion-shim";

export function LiquidGlassLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#e8e8ed] dark:bg-[#1c1c1c] transition-colors duration-500">
      <div className="flex flex-col items-center gap-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative"
        >
          {/* Ambient glow */}
          <motion.div
            className="absolute inset-0 rounded-[40px]"
            style={{
              background:
                "radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)",
              filter: "blur(20px)",
            }}
            animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />

          {/* Glass container */}
          <div
            className="relative px-12 py-10 rounded-[40px] overflow-hidden bg-white/5 dark:bg-white/3 border border-black/[0.08] dark:border-white/[0.08]"
            style={{
              backdropFilter: "blur(40px)",
              WebkitBackdropFilter: "blur(40px)",
            }}
          >
            <div className="relative z-10">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-5xl tracking-tight bg-gradient-to-br from-gray-900 to-gray-600 dark:from-white dark:to-white/60 bg-clip-text text-transparent"
                style={{
                  fontFamily: "var(--font-clash-grotesk, system-ui)",
                }}
              >
                CODA
              </motion.div>
            </div>

            {/* Shimmer sweep */}
            <motion.div
              className="absolute inset-0 opacity-30"
              style={{
                background:
                  "linear-gradient(135deg, transparent 0%, rgba(59, 130, 246, 0.1) 50%, transparent 100%)",
              }}
              animate={{ x: ["-100%", "100%"] }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "linear",
              }}
            />
          </div>
        </motion.div>

        {/* Loading dots */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex gap-2"
        >
          {[0, 1, 2].map((index) => (
            <motion.div
              key={index}
              className="size-2 rounded-full bg-blue-500/70 dark:bg-blue-500/60"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeInOut",
                delay: index * 0.2,
              }}
            />
          ))}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-sm text-gray-500 dark:text-white/40 tracking-wide"
          style={{ fontFamily: "var(--font-clash-grotesk, system-ui)" }}
        >
          Initializing
        </motion.p>
      </div>
    </div>
  );
}