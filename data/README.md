# Plan & Diary data backups

Per-user backup folders live here.

Current configured user:
- `lxy/plan/` → 计划数据
- `lxy/diary/` → 日记数据

The daily backup job commits and pushes changes under `data/` to `origin/main`.

Important limitation:
- The current Vercel-hosted frontend still stores live app data in browser local storage.
- This backup pipeline is ready for file-based exports/sync, but the frontend still needs an export/sync step to write JSON files into these folders.
