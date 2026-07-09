---
name: diffit-review
description: Address code-review comments left in Diffit (local diff viewer). Use when the user asks to address/fix Diffit review comments, mentions a diffit review file, or references annotations left on the working-tree diff.
---

# Diffit review annotations

## Locate the file

From the repository root:

```bash
git rev-parse --absolute-git-dir
```

The review file is `<git-dir>/diffit/review.json` (inside `.git`, not tracked by `git status`).

## JSON schema (version 1)

```json
{
  "version": 1,
  "annotations": [
    {
      "id": "k7f2ax9q",
      "file": "src/store.ts",
      "oldFile": "src/oldName.ts",
      "side": "new",
      "startLine": 42,
      "endLine": 45,
      "comment": "Memoize this selector.",
      "status": "open",
      "createdAt": "2026-07-08T18:00:00Z",
      "updatedAt": "2026-07-08T18:00:00Z",
      "anchor": {
        "contentHash": "<sha256 hex>",
        "lineText": "<exact startLine text>",
        "contextBefore": [],
        "contextAfter": []
      },
      "replies": [
        { "author": "agent", "text": "Done in a3f9c21.", "at": "2026-07-08T18:20:00Z" }
      ]
    }
  ]
}
```

- `file`: repo-relative path (NEW path for renames). `oldFile`: optional, renames only.
- `side`: `"old"` (HEAD / deleted side) or `"new"` (working tree / added side).
- `startLine` / `endLine`: 1-based inclusive line numbers on that side.
- `status`: `"open" | "resolved" | "outdated"`. Timestamps: RFC 3339 UTC.
- Preserve unknown fields anywhere in the file.

## Workflow

1. Read `review.json`.
2. For each annotation with `"status": "open"`:
   - Open `file` at `startLine`–`endLine` on the indicated `side` (`"old"` line numbers refer to the HEAD version of the file).
   - Address the `comment`.
   - Append to `replies`: `{ "author": "agent", "text": "<one-line summary>", "at": "<ISO timestamp>" }`.
   - Set `"status": "resolved"`.
3. If you deliberately decline one, append a reply with your reasoning and leave `"status": "open"`.
4. Write the file back as valid JSON. Preserve every other annotation and unrecognized field.
