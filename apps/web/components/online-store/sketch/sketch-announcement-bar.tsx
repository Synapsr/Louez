import { AnimatePresence, motion } from "framer-motion";

import { getContrastColor } from "../util.online-store-form";
import { SKETCH_TRANSITION } from "./sketch-palette";

interface SketchAnnouncementBarProps {
  enabled: boolean;
  text: string;
  primaryColor: string;
  reduceMotion: boolean;
}

/** The one line above the header, at its real height; slides in when the switch goes on. */
export const SketchAnnouncementBar = ({
  enabled,
  text,
  primaryColor,
  reduceMotion,
}: SketchAnnouncementBarProps) => {
  const visible = enabled && text.trim() !== "";
  const color = getContrastColor(primaryColor) === "white" ? "#ffffff" : "#09090b";

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          key="announcement"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : SKETCH_TRANSITION}
          className="overflow-hidden"
          data-slot="sketch-announcement"
        >
          <p
            className="truncate px-4 py-2 text-center text-sm transition-colors duration-300"
            style={{ backgroundColor: primaryColor, color }}
          >
            {text}
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
