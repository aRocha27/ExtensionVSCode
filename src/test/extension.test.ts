// This file contains reference snippets for the extension message bridge.
// The actual implementation lives in src/extension.ts.
//
// How the message bridge works:
//
// 1. On panel creation, notes are loaded and sent to the webview:
//    const notes = await loadNotes(context);
//    panel.webview.postMessage({ type: "NOTES_UPDATED", payload: notes });
//
// 2. The webview sends messages back via vscode.postMessage({ type, payload }).
//    The extension listens with panel.webview.onDidReceiveMessage(async (msg) => { ... })
//
// 3. Supported message types:
//    - PING          -> responds with PONG + shows info message
//    - GET_NOTES     -> responds with NOTES_UPDATED
//    - ADD_NOTE      -> persists note + responds with NOTES_UPDATED
//    - UPDATE_NOTE   -> updates note + responds with NOTES_UPDATED
//    - DELETE_NOTE   -> removes note + responds with NOTES_UPDATED
//    - REORDER_NOTES -> reorders notes array + responds with NOTES_UPDATED
//    - OPEN_FILE     -> opens file at specific line in the editor
//    - EXPORT_NOTES  -> triggers save dialog (JSON/MD/TXT)
//    - IMPORT_NOTES  -> merges imported notes, skipping duplicate IDs
//    - SAVE_INSIDE_PROJECT -> saves notes to .dev-info-diary/notes.json
//    - CHECK_DUPLICATE -> checks if a note with same file+lines or snippet already exists
//
// 4. Context menu commands:
//    - dd-devdiary.addSelection  -> opens panel with selected text pre-filled in composer
//    - dd-devdiary.quickSave     -> instantly saves selection as "Uncommented" note
