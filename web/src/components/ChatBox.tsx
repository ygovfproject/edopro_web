"use client";

import { useEffect, useRef, useState } from "react";
import { Box, IconButton, Stack, TextField, Typography } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import type { DuelClient } from "@/lib/game/client";

export default function ChatBox({ client, height = 220 }: { client: DuelClient; height?: number | string }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const last = client.chat[client.chat.length - 1]?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [last]);
  const send = () => {
    client.sendChat(text);
    setText("");
  };
  return (
    <Stack sx={{ height, minHeight: 0 }}>
      <Box sx={{ flex: 1, overflowY: "auto", px: 1, py: 0.5, fontSize: 13 }}>
        {client.chat.length === 0 && (
          <Typography variant="caption" color="text.disabled">
            No messages yet.
          </Typography>
        )}
        {client.chat.map((l) => (
          <Box key={l.id} sx={{ mb: 0.25, wordBreak: "break-word" }}>
            {l.kind === "system" || l.kind === "error" ? (
              <Typography component="span" variant="body2" sx={{ color: l.kind === "error" ? "error.light" : "secondary.light", fontSize: 13 }}>
                {l.text}
              </Typography>
            ) : (
              <Typography component="span" variant="body2" sx={{ fontSize: 13 }}>
                <b style={{ color: l.kind === "observer" ? "#aaa" : "#f5c518" }}>{l.name}:</b> {l.text}
              </Typography>
            )}
          </Box>
        ))}
        <div ref={endRef} />
      </Box>
      <Stack direction="row" spacing={0.5} sx={{ p: 0.5, borderTop: 1, borderColor: "divider" }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Chat"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) send();
          }}
          slotProps={{ htmlInput: { maxLength: 255 } }}
        />
        <IconButton size="small" onClick={send} disabled={!text.trim()}>
          <SendIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Stack>
  );
}
