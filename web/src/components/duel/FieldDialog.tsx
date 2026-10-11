"use client";

import { createContext, useContext } from "react";
import { Dialog, type DialogProps } from "@mui/material";

/**
 * The field window: the part of the duel screen from one player's LP bar to the other's.
 * Every pop-up of the duel opens inside it, centred, instead of over the whole page, so
 * the action bar, card details and log/chat stay visible and usable.
 */
export const FieldWindow = createContext<HTMLElement | null>(null);

/** Space between a pop-up and the edges of the field window (px). */
const MARGIN = 12;

/** A MUI Dialog that opens inside the field window (see FieldWindow). */
export default function FieldDialog({ sx, slotProps, ...props }: DialogProps) {
  const field = useContext(FieldWindow);
  // Until the field window is on screen there is nowhere to put the pop-up.
  if (!field) return null;
  return (
    <Dialog
      {...props}
      container={field}
      disableScrollLock
      sx={[
        {
          // Positioned in the field window rather than the viewport.
          position: "absolute",
          "& .MuiDialog-paper": { m: `${MARGIN}px`, maxHeight: `calc(100% - ${MARGIN * 2}px)` },
          "& .MuiDialog-paperFullWidth": { width: `calc(100% - ${MARGIN * 2}px)` },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
      slotProps={{
        ...slotProps,
        backdrop: { ...(slotProps?.backdrop as object), sx: { position: "absolute" } },
      }}
    />
  );
}
