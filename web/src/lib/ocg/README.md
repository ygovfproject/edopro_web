# Vendored from ocgcore-wasm

The files in this folder are copied from [n1xx1/ocgcore-wasm](https://github.com/n1xx1/ocgcore-wasm)
(MIT License, Copyright (c) 2025 Simone Miraglia), version 0.1.4. Only the pure TypeScript
message parsers and type definitions are used. The WebAssembly core itself is
**not** used: in online play the EDOPro server runs the duel.

Local changes:
- `types.ts`: dropped the `type_serialize` re-export.
- `type_message.ts`: added the missing `lp` field to `OcgFieldPlayer` (the parser already reads it).
- `messages.ts` / `type_message.ts`: `MOVE` also reads the trailing `reason` field.
- `queries.ts`: silenced an unused variable.
- `opcodes.ts`: `ISATTRIBUTE` compared against the card code instead of its attribute.
- `data.ts`, `index.ts`, `responses.ts`, `type_serialize.ts`: not copied.
  Responses are encoded by `../protocol/responses.ts` instead (the upstream
  SORT_CARD encoder writes an extra length byte the core does not expect).
