---
name: coda-docs
description: Update PROJECT_STATUS.md, PROJECT_HISTORY.md, and Notion tracker after completing a task
triggers:
  - update docs
  - update tracker
  - update project status
  - update notion
---

# CODA Docs Update

Updates all project tracking files and Notion after a task is completed.

## What to update

### 1. PROJECT_STATUS.md
Location: `/Users/jeremyvaughn/Documents/Claude/CODA/SolsticeAI/PROJECT_STATUS.md`

- Update the `Last updated:` timestamp to today
- Update the Phase line to reflect the completed task
- If there's an in-progress task block, mark it complete
- Add a TASK_COMPLETE block with:
  - Task number and title
  - Date completed
  - Summary of what was built (3-5 bullet points)
  - Key files changed

### 2. PROJECT_HISTORY.md
Location: `/Users/jeremyvaughn/Documents/Claude/CODA/SolsticeAI/PROJECT_HISTORY.md`

- Append a new entry at the bottom matching the existing format:
```
### Task [N] — [Title] ([Date])
- [Summary bullet 1]
- [Summary bullet 2]
- [Summary bullet 3]
```

### 3. Notion To Dos page
Page ID: `3207b78e5cab8108b521f81fe8cbd7a4`
URL: https://www.notion.so/rimark/To-Dos-3207b78e5cab8108b521f81fe8cbd7a4

- Change the task's header from `🔵 Task N` to `✅ Task N`
- Change status from `Planned` to `COMPLETE (YYYY-MM-DD)`
- Update the task count in the "Outstanding Tasks" header

### 4. Notion Build Tracker (main page)
Page ID: `30a7b78e5cab81c3ac4ed5faee7e3448`
URL: https://www.notion.so/rimark/Coda-Agentic-Payments-Build-Tracker-30a7b78e5cab81c3ac4ed5faee7e3448

- If a Build Log subpage exists for the current task range, append the task completion entry

## Execution notes

- Read each file before editing to get the current content
- Use `notion-fetch` to read Notion pages before updating
- Use `notion-update-page` with `update_content` command for edits
- If Notion update fails on content match, try `append` mode or adjust the match string
- Commit the local file changes to git (but don't push — the autopilot handles push)

## Narration
```
📝 Updating PROJECT_STATUS.md... ✓
📝 Updating PROJECT_HISTORY.md... ✓
📝 Updating Notion To Dos... ✓
📝 All docs updated for Task [N]
```
