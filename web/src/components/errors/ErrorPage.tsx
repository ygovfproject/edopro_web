"use client";

import Link from "next/link";
import { Box, Button, Stack, Typography } from "@mui/material";

export default function ErrorPage({ code, title, text }: { code: number; title: string; text: string }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3, bgcolor: "background.default" }}>
      <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center", maxWidth: 420 }}>
        <Typography sx={{ fontSize: 96, fontWeight: 900, lineHeight: 1, color: "primary.main" }}>{code}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
        <Typography color="text.secondary">{text}</Typography>
        <Button component={Link} href="/" variant="contained">
          Back to lobby
        </Button>
      </Stack>
    </Box>
  );
}
