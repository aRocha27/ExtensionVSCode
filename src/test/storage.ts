// This file contains reference snippets for the storage message handlers.
// The actual implementation lives in src/storage.ts and src/extension.ts.
//
// Message types handled by the extension:
//   GET_NOTES     -> responds with NOTES_UPDATED
//   ADD_NOTE      -> persists + responds with NOTES_UPDATED
//   UPDATE_NOTE   -> persists + responds with NOTES_UPDATED
//   DELETE_NOTE   -> persists + responds with NOTES_UPDATED
//   REORDER_NOTES -> persists + responds with NOTES_UPDATED
//   OPEN_FILE     -> opens file at line in editor
//   EXPORT_NOTES  -> triggers save dialog
//   IMPORT_NOTES  -> merges imported notes (skips duplicate IDs)
//   SAVE_INSIDE_PROJECT -> confirms save to .dev-info-diary/notes.json
//   CHECK_DUPLICATE -> checks for existing note with same file+lines or snippet
// This file contains reference snippets for the storage message handlers.
// The actual implementation lives in src/storage.ts and src/extension.ts.
//
// Message types handled by the extension:
//   GET_NOTES     -> responds with NOTES_UPDATED
//   ADD_NOTE      -> persists + responds with NOTES_UPDATED
//   UPDATE_NOTE   -> persists + responds with NOTES_UPDATED
//   DELETE_NOTE   -> persists + responds with NOTES_UPDATED
//   REORDER_NOTES -> persists + responds with NOTES_UPDATED
//   OPEN_FILE     -> opens file at line in editor
//   EXPORT_NOTES  -> triggers save dialog
//   IMPORT_NOTES  -> merges imported notes (skips duplicate IDs)
//   SAVE_INSIDE_PROJECT -> confirms save to .dev-info-diary/notes.json
//   CHECK_DUPLICATE -> checks for existing note with same file+lines or snippet
