import * as vscode from "vscode";
import { loadNotes, saveNotes } from "./storage";
import { DiaryNote } from "./types";

/* ------------------------------------------------------------------ */
/*  Activate                                                          */
/* ------------------------------------------------------------------ */
export function activate(context: vscode.ExtensionContext) {
  console.log("DD DevDiary activated");

  let currentPanel: vscode.WebviewPanel | undefined;

  /* ---------- open panel command ---------------------------------- */
  const openCmd = vscode.commands.registerCommand("dd-devdiary.open", async () => {
    // If panel already exists, reveal it instead of creating a new one
    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.Two);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "devInfoDiary",
      "Dev Info Diary",
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    currentPanel = panel;

    // Clear panel reference when disposed
    panel.onDidDispose(() => {
      currentPanel = undefined;
    });

    // load persisted notes
    let notes: DiaryNote[] = await loadNotes(context);

    panel.webview.html = getWebviewHtml(panel.webview);

    // send initial notes
    panel.webview.postMessage({ type: "NOTES_UPDATED", payload: notes });

    // message bridge
    panel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg?.type) { return; }

      switch (msg.type) {
        case "PING": {
          vscode.window.showInformationMessage("Dev Info Diary: PONG");
          panel.webview.postMessage({ type: "PONG", at: new Date().toISOString() });
          break;
        }

        case "GET_NOTES": {
          panel.webview.postMessage({ type: "NOTES_UPDATED", payload: notes });
          break;
        }

        case "ADD_NOTE": {
          const note = msg.payload as DiaryNote;
          notes = [note, ...notes];
          await saveNotes(context, notes);
          panel.webview.postMessage({ type: "NOTES_UPDATED", payload: notes });
          vscode.window.showInformationMessage("Saved to Dev Info Diary");
          break;
        }

        case "UPDATE_NOTE": {
          const updated = msg.payload as DiaryNote;
          notes = notes.map((n) => (n.id === updated.id ? updated : n));
          await saveNotes(context, notes);
          panel.webview.postMessage({ type: "NOTES_UPDATED", payload: notes });
          break;
        }

        case "DELETE_NOTE": {
          const { id } = msg.payload as { id: string };
          notes = notes.filter((n) => n.id !== id);
          await saveNotes(context, notes);
          panel.webview.postMessage({ type: "NOTES_UPDATED", payload: notes });
          break;
        }

        case "REORDER_NOTES": {
          notes = msg.payload as DiaryNote[];
          await saveNotes(context, notes);
          panel.webview.postMessage({ type: "NOTES_UPDATED", payload: notes });
          break;
        }

        case "OPEN_FILE": {
          const { filePath, line } = msg.payload as { filePath: string; line: number };
          try {
            const doc = await vscode.workspace.openTextDocument(filePath);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            const pos = new vscode.Position(Math.max(0, line - 1), 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          } catch {
            vscode.window.showErrorMessage(`Cannot open file: ${filePath}`);
          }
          break;
        }

        case "EXPORT_NOTES": {
          const { format } = msg.payload as { format: string };
          await exportNotes(notes, format);
          break;
        }

        case "IMPORT_NOTES": {
          const imported = msg.payload as DiaryNote[];
          // merge: skip duplicates by id
          const existingIds = new Set(notes.map((n) => n.id));
          const newNotes = imported.filter((n) => !existingIds.has(n.id));
          notes = [...newNotes, ...notes];
          await saveNotes(context, notes);
          panel.webview.postMessage({ type: "NOTES_UPDATED", payload: notes });
          vscode.window.showInformationMessage(`Imported ${newNotes.length} new notes`);
          break;
        }

        case "SAVE_INSIDE_PROJECT": {
          // already saving via storage — just confirm
          await saveNotes(context, notes);
          vscode.window.showInformationMessage("Notes saved to .dev-info-diary/notes.json");
          break;
        }

        case "CHECK_DUPLICATE": {
          const { filePath, lineStart, lineEnd, codeSnippet } = msg.payload as {
            filePath: string;
            lineStart: number;
            lineEnd: number;
            codeSnippet: string;
          };
          const dup = notes.find(
            (n) =>
              (n.filePath === filePath && n.lineStart === lineStart && n.lineEnd === lineEnd) ||
              n.codeSnippet === codeSnippet
          );
          panel.webview.postMessage({
            type: "DUPLICATE_RESULT",
            payload: dup ? { exists: true, note: dup } : { exists: false },
          });
          break;
        }
      }
    });
  });

  /* ---------- add-selection command (context menu) ----------------- */
  const addSelectionCmd = vscode.commands.registerCommand("dd-devdiary.addSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor");
      return;
    }
    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage("No code selected");
      return;
    }
    const text = editor.document.getText(selection);
    const filePath = editor.document.uri.fsPath;
    const lineStart = selection.start.line + 1;
    const lineEnd = selection.end.line + 1;

    const selectionData = { filePath, lineStart, lineEnd, codeSnippet: text };

    // Open the panel first (creates it if it doesn't exist)
    await vscode.commands.executeCommand("dd-devdiary.open");

    // Small delay to ensure the webview is ready, then send the selection
    setTimeout(() => {
      if (currentPanel) {
        currentPanel.webview.postMessage({ type: "SELECTION_READY", payload: selectionData });
      }
    }, 300);
  });

  /* ---------- quick-save command ----------------------------------- */
  const quickSaveCmd = vscode.commands.registerCommand("dd-devdiary.quickSave", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor");
      return;
    }
    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage("No code selected");
      return;
    }

    const existingNotes: DiaryNote[] = await loadNotes(context);
    const now = new Date().toISOString();
    const note: DiaryNote = {
      id: generateUuid(),
      title: `Snippet #${existingNotes.length + 1}`,
      filePath: editor.document.uri.fsPath,
      lineStart: selection.start.line + 1,
      lineEnd: selection.end.line + 1,
      codeSnippet: editor.document.getText(selection),
      description: "",
      tags: ["Uncommented"],
      priority: 3,
      status: "Uncommented",
      createdAt: now,
      updatedAt: now,
    };

    let qNotes = [...existingNotes];
    qNotes = [note, ...qNotes];
    await saveNotes(context, qNotes);
    vscode.window.showInformationMessage(`Quick saved: ${note.title}`);

    // Refresh the panel if it's open
    if (currentPanel) {
      currentPanel.webview.postMessage({ type: "NOTES_UPDATED", payload: qNotes });
    }
  });

  context.subscriptions.push(openCmd, addSelectionCmd, quickSaveCmd);
}

export function deactivate() {}

/* ------------------------------------------------------------------ */
/*  Export helper                                                      */
/* ------------------------------------------------------------------ */
async function exportNotes(notes: DiaryNote[], format: string) {
  let content = "";
  const ext = format === "txt" ? "txt" : format === "md" ? "md" : "json";

  if (format === "txt" || format === "md") {
    content = notes
      .map((n) => {
        const header = format === "md" ? `## ${n.title}` : `=== ${n.title} ===`;
        const meta = `File: ${n.filePath}  Lines: ${n.lineStart}-${n.lineEnd}  Priority: ${n.priority}  Status: ${n.status}`;
        const tags = n.tags.length ? `Tags: ${n.tags.join(", ")}` : "";
        const code = format === "md" ? "```\n" + n.codeSnippet + "\n```" : n.codeSnippet;
        const desc = n.description ? `\n${n.description}` : "";
        return [header, meta, tags, code, desc].filter(Boolean).join("\n");
      })
      .join("\n\n---\n\n");
  } else {
    content = JSON.stringify(notes, null, 2);
  }

  const uri = await vscode.window.showSaveDialog({
    filters: { [format.toUpperCase()]: [ext] },
    defaultUri: vscode.Uri.file(`dev-diary-export.${ext}`),
  });

  if (uri) {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
    vscode.window.showInformationMessage(`Exported ${notes.length} notes as ${format.toUpperCase()}`);
  }
}

/* ------------------------------------------------------------------ */
/*  UUID helper                                                       */
/* ------------------------------------------------------------------ */
function generateUuid(): string {
  // simple v4 uuid
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ------------------------------------------------------------------ */
/*  Webview HTML                                                      */
/* ------------------------------------------------------------------ */
function getWebviewHtml(webview: vscode.Webview): string {
  const nonce = getNonce();

  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             img-src ${webview.cspSource} https: data:;
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dev Info Diary</title>
  <style>
    /* ── Reset & Base ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground, #ccc);
      background: var(--vscode-sideBar-background, #1e1e1e);
      padding: 0;
      line-height: 1.5;
    }

    /* ── Tabs ── */
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      background: var(--vscode-tab-activeBackground, #1e1e1e);
    }
    .tab {
      flex: 1;
      padding: 10px 8px;
      text-align: center;
      cursor: pointer;
      border: none;
      background: transparent;
      color: var(--vscode-foreground, #999);
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      border-bottom: 2px solid transparent;
      transition: all 0.15s ease;
    }
    .tab:hover { color: var(--vscode-foreground, #ddd); }
    .tab.active {
      color: var(--vscode-textLink-foreground, #4fc1ff);
      border-bottom-color: var(--vscode-textLink-foreground, #4fc1ff);
    }

    /* ── Tab Content ── */
    .tab-content { display: none; padding: 12px; }
    .tab-content.active { display: block; }

    /* ── Controls Bar ── */
    .controls { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    .search-input {
      flex: 1;
      min-width: 120px;
      padding: 6px 10px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 4px;
      background: var(--vscode-input-background, #2a2a2a);
      color: var(--vscode-input-foreground, #ccc);
      font-size: 12px;
      outline: none;
    }
    .search-input:focus { border-color: var(--vscode-focusBorder, #4fc1ff); }
    select {
      padding: 6px 8px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 4px;
      background: var(--vscode-input-background, #2a2a2a);
      color: var(--vscode-input-foreground, #ccc);
      font-size: 12px;
      cursor: pointer;
    }

    /* ── Tag Filters ── */
    .tag-filters { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 10px; }
    .tag-chip {
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid var(--vscode-badge-background, #4d4d4d);
      background: transparent;
      color: var(--vscode-foreground, #bbb);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tag-chip.selected {
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
    }

    /* ── Notes List ── */
    .notes-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .empty-state {
      text-align: center;
      padding: 40px 16px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .empty-state p { font-size: 12px; margin-top: 8px; }

    /* ── Note Card ── */
    .note-card {
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      background: var(--vscode-editor-background, #252526);
      transition: border-color 0.15s ease;
      cursor: grab;
    }
    .note-card:hover { border-color: var(--vscode-focusBorder, #4fc1ff); }
    .note-card.dragging { opacity: 0.5; }
    .note-card.drag-over { border-color: var(--vscode-textLink-foreground, #4fc1ff); border-style: dashed; }

    .card-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      cursor: pointer;
      user-select: none;
    }
    .chevron {
      width: 16px;
      text-align: center;
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #888);
      transition: transform 0.15s ease;
    }
    .chevron.open { transform: rotate(90deg); }
    .card-title {
      flex: 1;
      font-weight: 600;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .priority-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 8px;
      font-weight: 600;
    }
    .priority-1, .priority-2 { background: #2d4a2d; color: #6abf6a; }
    .priority-3 { background: #4a4a2d; color: #bfbf6a; }
    .priority-4, .priority-5 { background: #4a2d2d; color: #bf6a6a; }

    .card-actions {
      display: flex;
      gap: 2px;
    }
    .icon-btn {
      width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      border: none;
      background: transparent;
      color: var(--vscode-descriptionForeground, #888);
      cursor: pointer;
      border-radius: 4px;
      font-size: 12px;
    }
    .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, #333); color: var(--vscode-foreground, #ddd); }
    .icon-btn.danger:hover { color: #f44; }

    .card-body {
      display: none;
      padding: 0 10px 10px;
    }
    .card-body.open { display: block; }

    .code-block {
      background: var(--vscode-textCodeBlock-background, #1a1a1a);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 4px;
      padding: 8px 10px;
      font-family: var(--vscode-editor-font-family, "Cascadia Code", "Fira Code", monospace);
      font-size: 12px;
      line-height: 1.4;
      overflow-x: auto;
      white-space: pre;
      max-height: 200px;
      margin-bottom: 8px;
    }

    .note-desc {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #999);
      margin-bottom: 6px;
    }

    .note-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
    .note-tag {
      padding: 1px 6px;
      border-radius: 8px;
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
      font-size: 10px;
    }

    .note-footer {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #666);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .open-link {
      color: var(--vscode-textLink-foreground, #4fc1ff);
      cursor: pointer;
      text-decoration: none;
      font-size: 11px;
    }
    .open-link:hover { text-decoration: underline; }

    /* ── Composer ── */
    .composer {
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      padding: 12px;
      background: var(--vscode-editor-background, #252526);
    }
    .composer h3 {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .form-group { margin-bottom: 8px; }
    .form-group label {
      display: block;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 4px;
    }
    .form-input, .form-textarea {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 4px;
      background: var(--vscode-input-background, #2a2a2a);
      color: var(--vscode-input-foreground, #ccc);
      font-size: 12px;
      outline: none;
      font-family: inherit;
    }
    .form-textarea { resize: vertical; min-height: 50px; }
    .form-input:focus, .form-textarea:focus { border-color: var(--vscode-focusBorder, #4fc1ff); }

    .form-row { display: flex; gap: 8px; }
    .form-row > * { flex: 1; }

    .btn-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
    .btn {
      padding: 6px 14px;
      border-radius: 4px;
      border: 1px solid var(--vscode-button-border, transparent);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    }
    .btn-primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
    .btn-secondary {
      background: transparent;
      color: var(--vscode-foreground, #ccc);
      border-color: var(--vscode-input-border, #3c3c3c);
    }
    .btn-secondary:hover { background: var(--vscode-toolbar-hoverBackground, #333); }

    /* ── Delete Modal ── */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: var(--vscode-editor-background, #252526);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 8px;
      padding: 20px;
      width: 300px;
      max-width: 90%;
    }
    .modal h3 { font-size: 14px; margin-bottom: 10px; }
    .modal p { font-size: 12px; color: var(--vscode-descriptionForeground, #999); margin-bottom: 12px; }

    /* ── Edit Modal ── */
    .edit-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .edit-overlay.active { display: flex; }

    /* ── Export/Import ── */
    .export-section { margin-bottom: 16px; }
    .export-section h3 { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
    .format-options { display: flex; gap: 6px; margin-bottom: 10px; }
    .format-btn {
      padding: 6px 12px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 4px;
      background: transparent;
      color: var(--vscode-foreground, #ccc);
      cursor: pointer;
      font-size: 12px;
    }
    .format-btn:hover, .format-btn.selected {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border-color: transparent;
    }

    /* ── Settings ── */
    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    .setting-label { font-size: 12px; }
    .setting-desc { font-size: 11px; color: var(--vscode-descriptionForeground, #888); }
    .toggle {
      position: relative;
      width: 36px; height: 20px;
      border-radius: 10px;
      border: none;
      background: var(--vscode-input-border, #555);
      cursor: pointer;
      transition: background 0.2s;
    }
    .toggle.on { background: var(--vscode-textLink-foreground, #4fc1ff); }
    .toggle::after {
      content: "";
      position: absolute;
      top: 3px; left: 3px;
      width: 14px; height: 14px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.2s;
    }
    .toggle.on::after { transform: translateX(16px); }

    /* ── Toast ── */
    .toast {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%) translateY(60px);
      background: var(--vscode-notificationsBackground, #252526);
      border: 1px solid var(--vscode-panel-border, #444);
      color: var(--vscode-foreground, #ddd);
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 2000;
      opacity: 0;
      transition: all 0.3s ease;
      pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

    /* ── Stats ── */
    .stats-bar {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      padding: 4px 0;
      margin-bottom: 6px;
    }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, #424242); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, #555); }
  </style>
</head>
<body>
  <!-- TABS -->
  <div class="tabs">
    <button class="tab active" data-tab="notes">Notes</button>
    <button class="tab" data-tab="export">Export / Import</button>
    <button class="tab" data-tab="settings">Settings</button>
  </div>

  <!-- ═══════ NOTES TAB ═══════ -->
  <div id="tab-notes" class="tab-content active">
    <div class="controls">
      <input class="search-input" id="search" type="text" placeholder="Search notes..." />
      <select id="sort">
        <option value="date-desc">Newest first</option>
        <option value="date-asc">Oldest first</option>
        <option value="priority-desc">Priority: High first</option>
        <option value="priority-asc">Priority: Low first</option>
        <option value="line-asc">Line: Ascending</option>
        <option value="line-desc">Line: Descending</option>
      </select>
    </div>

    <div class="tag-filters" id="tagFilters"></div>
    <div class="stats-bar" id="statsBar"></div>
    <div class="notes-list" id="notesList"></div>

    <!-- Composer -->
    <div class="composer" id="composer">
      <h3>New Note</h3>
      <div class="form-group">
        <label>Title</label>
        <input class="form-input" id="c-title" placeholder="Snippet title..." />
      </div>
      <div class="form-group">
        <label>Code Preview</label>
        <div class="code-block" id="c-code" style="min-height:40px;color:#666;">Select code in the editor first...</div>
      </div>
      <div class="form-group">
        <label>Comment / Description</label>
        <textarea class="form-textarea" id="c-desc" placeholder="What does this code do?"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Tags (comma separated)</label>
          <input class="form-input" id="c-tags" placeholder="e.g. bugfix, api" />
        </div>
        <div class="form-group">
          <label>Priority</label>
          <select id="c-priority" class="form-input">
            <option value="1">1 - Low</option>
            <option value="2">2</option>
            <option value="3" selected>3 - Medium</option>
            <option value="4">4</option>
            <option value="5">5 - High</option>
          </select>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="c-cancel">Cancel</button>
        <button class="btn btn-primary" id="c-save">Save</button>
        <button class="btn btn-secondary" id="c-mock">+ Add Mock</button>
      </div>
    </div>
  </div>

  <!-- ═══════ EXPORT / IMPORT TAB ═══════ -->
  <div id="tab-export" class="tab-content">
    <div class="export-section">
      <h3>Save Inside Project</h3>
      <p style="font-size:12px;color:var(--vscode-descriptionForeground,#888);margin-bottom:8px;">
        Saves to <code>.dev-info-diary/notes.json</code> in your workspace.
      </p>
      <button class="btn btn-primary" id="saveProject">Save to Project</button>
    </div>

    <div class="export-section">
      <h3>Export Notes</h3>
      <div class="format-options">
        <button class="format-btn selected" data-format="json">JSON</button>
        <button class="format-btn" data-format="md">Markdown</button>
        <button class="format-btn" data-format="txt">Plain Text</button>
      </div>
      <button class="btn btn-primary" id="exportBtn">Export</button>
    </div>

    <div class="export-section">
      <h3>Import Notes</h3>
      <p style="font-size:12px;color:var(--vscode-descriptionForeground,#888);margin-bottom:8px;">
        Upload a JSON file. Duplicate notes (same ID) will be skipped.
      </p>
      <button class="btn btn-primary" id="importBtn">Import JSON File</button>
    </div>
  </div>

  <!-- ═══════ SETTINGS TAB ═══════ -->
  <div id="tab-settings" class="tab-content">
    <div class="setting-row">
      <div>
        <div class="setting-label">Require typing DELETE to confirm</div>
        <div class="setting-desc">When enabled, deletion requires typing "DELETE".</div>
      </div>
      <button class="toggle on" id="toggleDeleteConfirm"></button>
    </div>
    <div class="setting-row">
      <div>
        <div class="setting-label">Copy format</div>
        <div class="setting-desc">Clipboard format for the Copy action.</div>
      </div>
      <select id="copyFormat" style="width:auto;">
        <option value="plain">Plain</option>
        <option value="markdown">Markdown</option>
      </select>
    </div>
  </div>

  <!-- ═══════ DELETE MODAL ═══════ -->
  <div class="modal-overlay" id="deleteModal">
    <div class="modal">
      <h3>Confirm Deletion</h3>
      <p id="deleteModalText">Type <strong>DELETE</strong> to confirm.</p>
      <input class="form-input" id="deleteInput" placeholder='Type "DELETE"' />
      <div class="btn-row" style="margin-top:12px;">
        <button class="btn btn-secondary" id="deleteCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="deleteConfirmBtn" disabled>Confirm</button>
      </div>
    </div>
  </div>

  <!-- ═══════ EDIT MODAL ═══════ -->
  <div class="edit-overlay" id="editModal">
    <div class="modal" style="width:340px;">
      <h3>Edit Note</h3>
      <div class="form-group">
        <label>Title</label>
        <input class="form-input" id="e-title" />
      </div>
      <div class="form-group">
        <label>Comment / Description</label>
        <textarea class="form-textarea" id="e-desc"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Tags</label>
          <input class="form-input" id="e-tags" />
        </div>
        <div class="form-group">
          <label>Priority</label>
          <select id="e-priority" class="form-input">
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="e-cancel">Cancel</button>
        <button class="btn btn-primary" id="e-save">Save</button>
      </div>
    </div>
  </div>

  <!-- ═══════ TOAST ═══════ -->
  <div class="toast" id="toast"></div>

  <!-- ═══════ SCRIPT ═══════ -->
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    /* ── State ── */
    let notes = [];
    let expandedIds = new Set();
    let searchQuery = "";
    let sortBy = "date-desc";
    let selectedTags = new Set();
    let exportFormat = "json";
    let deleteNoteId = null;
    let editNoteId = null;

    /* ── Settings ── */
    let settings = {
      requireDeleteConfirm: true,
      copyFormat: "plain"
    };

    /* ── DOM refs ── */
    const $notesList = document.getElementById("notesList");
    const $search = document.getElementById("search");
    const $sort = document.getElementById("sort");
    const $tagFilters = document.getElementById("tagFilters");
    const $statsBar = document.getElementById("statsBar");
    const $toast = document.getElementById("toast");

    // Composer
    const $cTitle = document.getElementById("c-title");
    const $cCode = document.getElementById("c-code");
    const $cDesc = document.getElementById("c-desc");
    const $cTags = document.getElementById("c-tags");
    const $cPriority = document.getElementById("c-priority");

    // Delete modal
    const $deleteModal = document.getElementById("deleteModal");
    const $deleteModalText = document.getElementById("deleteModalText");
    const $deleteInput = document.getElementById("deleteInput");
    const $deleteConfirmBtn = document.getElementById("deleteConfirmBtn");

    // Edit modal
    const $editModal = document.getElementById("editModal");

    /* ── Tabs ── */
    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
      });
    });

    /* ── Search & Sort ── */
    $search.addEventListener("input", () => { searchQuery = $search.value.toLowerCase(); renderNotes(); });
    $sort.addEventListener("change", () => { sortBy = $sort.value; renderNotes(); });

    /* ── Composer ── */
    let pendingSelection = null;

    document.getElementById("c-cancel").addEventListener("click", () => {
      resetComposer();
    });

    document.getElementById("c-save").addEventListener("click", () => {
      const title = $cTitle.value.trim() || "Snippet #" + (notes.length + 1);
      const now = new Date().toISOString();
      const note = {
        id: uuid(),
        title: title,
        filePath: pendingSelection ? pendingSelection.filePath : "no-file",
        lineStart: pendingSelection ? pendingSelection.lineStart : 1,
        lineEnd: pendingSelection ? pendingSelection.lineEnd : 1,
        codeSnippet: pendingSelection ? pendingSelection.codeSnippet : "",
        description: $cDesc.value.trim(),
        tags: $cTags.value.split(",").map(t => t.trim()).filter(Boolean),
        priority: parseInt($cPriority.value),
        status: $cDesc.value.trim() ? "Commented" : "Uncommented",
        createdAt: now,
        updatedAt: now
      };
      vscode.postMessage({ type: "ADD_NOTE", payload: note });
      resetComposer();
      showToast("Note saved!");
    });

    document.getElementById("c-mock").addEventListener("click", () => {
      const now = new Date().toISOString();
      const mockSnippets = [
        { code: "const server = http.createServer((req, res) => {\\n  res.writeHead(200);\\n  res.end('Hello');\\n});", file: "src/server.ts" },
        { code: "export async function fetchData(url: string) {\\n  const res = await fetch(url);\\n  return res.json();\\n}", file: "src/api.ts" },
        { code: "interface User {\\n  id: string;\\n  name: string;\\n  email: string;\\n}", file: "src/types.ts" },
      ];
      const mock = mockSnippets[notes.length % mockSnippets.length];
      const note = {
        id: uuid(),
        title: "Snippet #" + (notes.length + 1),
        filePath: mock.file,
        lineStart: 1 + Math.floor(Math.random() * 50),
        lineEnd: 4 + Math.floor(Math.random() * 50),
        codeSnippet: mock.code,
        description: "",
        tags: ["Uncommented"],
        priority: 1 + Math.floor(Math.random() * 5),
        status: "Uncommented",
        createdAt: now,
        updatedAt: now
      };
      vscode.postMessage({ type: "ADD_NOTE", payload: note });
      showToast("Mock note added!");
    });

    function resetComposer() {
      $cTitle.value = "";
      $cDesc.value = "";
      $cTags.value = "";
      $cPriority.value = "3";
      $cCode.textContent = "Select code in the editor first...";
      $cCode.style.color = "#666";
      pendingSelection = null;
    }

    /* ── Delete flow ── */
    function requestDelete(id) {
      deleteNoteId = id;
      if (settings.requireDeleteConfirm) {
        $deleteModalText.innerHTML = 'Type <strong>DELETE</strong> to confirm.';
        $deleteInput.style.display = "";
        $deleteInput.value = "";
        $deleteConfirmBtn.disabled = true;
        $deleteModal.classList.add("active");
        $deleteInput.focus();
      } else {
        // simple confirm
        $deleteModalText.innerHTML = "Are you sure you want to delete this note?";
        $deleteInput.style.display = "none";
        $deleteConfirmBtn.disabled = false;
        $deleteModal.classList.add("active");
      }
    }

    $deleteInput.addEventListener("input", () => {
      $deleteConfirmBtn.disabled = $deleteInput.value !== "DELETE";
    });

    document.getElementById("deleteCancelBtn").addEventListener("click", () => {
      $deleteModal.classList.remove("active");
      deleteNoteId = null;
    });

    $deleteConfirmBtn.addEventListener("click", () => {
      if (deleteNoteId) {
        vscode.postMessage({ type: "DELETE_NOTE", payload: { id: deleteNoteId } });
        showToast("Note deleted");
      }
      $deleteModal.classList.remove("active");
      deleteNoteId = null;
    });

    /* ── Edit flow ── */
    function openEdit(id) {
      const note = notes.find(n => n.id === id);
      if (!note) return;
      editNoteId = id;
      document.getElementById("e-title").value = note.title;
      document.getElementById("e-desc").value = note.description;
      document.getElementById("e-tags").value = note.tags.join(", ");
      document.getElementById("e-priority").value = note.priority;
      $editModal.classList.add("active");
    }

    document.getElementById("e-cancel").addEventListener("click", () => {
      $editModal.classList.remove("active");
      editNoteId = null;
    });

    document.getElementById("e-save").addEventListener("click", () => {
      const note = notes.find(n => n.id === editNoteId);
      if (!note) return;
      const updated = {
        ...note,
        title: document.getElementById("e-title").value.trim() || note.title,
        description: document.getElementById("e-desc").value.trim(),
        tags: document.getElementById("e-tags").value.split(",").map(t => t.trim()).filter(Boolean),
        priority: parseInt(document.getElementById("e-priority").value),
        status: document.getElementById("e-desc").value.trim() ? "Commented" : "Uncommented",
        updatedAt: new Date().toISOString()
      };
      vscode.postMessage({ type: "UPDATE_NOTE", payload: updated });
      $editModal.classList.remove("active");
      editNoteId = null;
      showToast("Note updated");
    });

    /* ── Copy ── */
    function copyNote(id) {
      const note = notes.find(n => n.id === id);
      if (!note) return;
      let text;
      if (settings.copyFormat === "markdown") {
        text = "## " + note.title + "\\n\\n"
          + "\`\`\`\\n" + note.codeSnippet + "\\n\`\`\`\\n\\n"
          + "File: " + note.filePath + " Lines: " + note.lineStart + "-" + note.lineEnd;
      } else {
        text = note.codeSnippet + "\\n// " + note.filePath + ":" + note.lineStart + "-" + note.lineEnd;
      }
      navigator.clipboard.writeText(text).then(() => showToast("Copied to clipboard"));
    }

    /* ── Export/Import ── */
    document.querySelectorAll(".format-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".format-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        exportFormat = btn.dataset.format;
      });
    });

    document.getElementById("exportBtn").addEventListener("click", () => {
      vscode.postMessage({ type: "EXPORT_NOTES", payload: { format: exportFormat } });
    });

    document.getElementById("saveProject").addEventListener("click", () => {
      vscode.postMessage({ type: "SAVE_INSIDE_PROJECT" });
      showToast("Saved to project!");
    });

    document.getElementById("importBtn").addEventListener("click", () => {
      // Ask extension to open file dialog — for now, read via input
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const imported = JSON.parse(ev.target.result);
            if (Array.isArray(imported)) {
              vscode.postMessage({ type: "IMPORT_NOTES", payload: imported });
              showToast("Import complete!");
            } else {
              showToast("Invalid format: expected an array");
            }
          } catch { showToast("Error parsing JSON"); }
        };
        reader.readAsText(file);
      };
      input.click();
    });

    /* ── Settings ── */
    const $toggleDelete = document.getElementById("toggleDeleteConfirm");
    $toggleDelete.addEventListener("click", () => {
      settings.requireDeleteConfirm = !settings.requireDeleteConfirm;
      $toggleDelete.classList.toggle("on", settings.requireDeleteConfirm);
    });

    document.getElementById("copyFormat").addEventListener("change", (e) => {
      settings.copyFormat = e.target.value;
    });

    /* ── Drag & Drop ── */
    let dragSrcIndex = null;

    function handleDragStart(e, index) {
      dragSrcIndex = index;
      e.currentTarget.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    }
    function handleDragOver(e) {
      e.preventDefault();
      e.currentTarget.classList.add("drag-over");
    }
    function handleDragLeave(e) {
      e.currentTarget.classList.remove("drag-over");
    }
    function handleDrop(e, index) {
      e.preventDefault();
      e.currentTarget.classList.remove("drag-over");
      if (dragSrcIndex === null || dragSrcIndex === index) return;
      const reordered = [...notes];
      const [moved] = reordered.splice(dragSrcIndex, 1);
      reordered.splice(index, 0, moved);
      vscode.postMessage({ type: "REORDER_NOTES", payload: reordered });
    }
    function handleDragEnd(e) {
      e.currentTarget.classList.remove("dragging");
      dragSrcIndex = null;
    }

    /* ── Render ── */
    function renderNotes() {
      // collect all tags
      const allTags = new Set();
      notes.forEach(n => n.tags.forEach(t => allTags.add(t)));

      // tag filter chips
      $tagFilters.innerHTML = "";
      allTags.forEach(tag => {
        const chip = document.createElement("button");
        chip.className = "tag-chip" + (selectedTags.has(tag) ? " selected" : "");
        chip.textContent = tag;
        chip.addEventListener("click", () => {
          if (selectedTags.has(tag)) selectedTags.delete(tag);
          else selectedTags.add(tag);
          renderNotes();
        });
        $tagFilters.appendChild(chip);
      });

      // filter
      let filtered = notes.filter(n => {
        if (searchQuery) {
          const q = searchQuery;
          const match = (n.title || "").toLowerCase().includes(q)
            || (n.codeSnippet || "").toLowerCase().includes(q)
            || (n.description || "").toLowerCase().includes(q)
            || n.tags.some(t => t.toLowerCase().includes(q));
          if (!match) return false;
        }
        if (selectedTags.size > 0) {
          const hasTag = n.tags.some(t => selectedTags.has(t));
          if (!hasTag) return false;
        }
        return true;
      });

      // sort
      filtered = [...filtered].sort((a, b) => {
        switch (sortBy) {
          case "date-desc": return new Date(b.createdAt) - new Date(a.createdAt);
          case "date-asc": return new Date(a.createdAt) - new Date(b.createdAt);
          case "priority-desc": return b.priority - a.priority;
          case "priority-asc": return a.priority - b.priority;
          case "line-asc": return a.lineStart - b.lineStart;
          case "line-desc": return b.lineStart - a.lineStart;
          default: return 0;
        }
      });

      // stats
      $statsBar.textContent = filtered.length + " note" + (filtered.length !== 1 ? "s" : "")
        + (searchQuery || selectedTags.size ? " (filtered)" : "");

      // render list
      if (filtered.length === 0) {
        $notesList.innerHTML = '<div class="empty-state"><p>No notes yet. Select code and click Save.</p></div>';
        return;
      }

      $notesList.innerHTML = "";
      filtered.forEach((note, idx) => {
        const isOpen = expandedIds.has(note.id);
        const prioLabel = ["", "Low", "", "Med", "", "High"][note.priority] || "";

        const card = document.createElement("div");
        card.className = "note-card";
        card.draggable = true;
        card.addEventListener("dragstart", (e) => handleDragStart(e, idx));
        card.addEventListener("dragover", handleDragOver);
        card.addEventListener("dragleave", handleDragLeave);
        card.addEventListener("drop", (e) => handleDrop(e, idx));
        card.addEventListener("dragend", handleDragEnd);

        const escapedSnippet = escapeHtml(note.codeSnippet || "");
        const escapedDesc = escapeHtml(note.description || "");
        const shortFile = (note.filePath || "").split("/").slice(-2).join("/");

        card.innerHTML = \`
          <div class="card-header" data-id="\${note.id}">
            <span class="chevron \${isOpen ? "open" : ""}">&#9654;</span>
            <span class="card-title">\${escapeHtml(note.title)}</span>
            <span class="priority-badge priority-\${note.priority}">\${note.priority} \${prioLabel}</span>
            <div class="card-actions">
              <button class="icon-btn" title="Copy" data-action="copy" data-id="\${note.id}">&#128203;</button>
              <button class="icon-btn" title="Edit" data-action="edit" data-id="\${note.id}">&#9998;</button>
              <button class="icon-btn danger" title="Delete" data-action="delete" data-id="\${note.id}">&#128465;</button>
            </div>
          </div>
          <div class="card-body \${isOpen ? "open" : ""}">
            <div class="code-block">\${escapedSnippet}</div>
            \${escapedDesc ? '<div class="note-desc">' + escapedDesc + '</div>' : ""}
            <div class="note-tags">\${note.tags.map(t => '<span class="note-tag">' + escapeHtml(t) + '</span>').join("")}</div>
            <div class="note-footer">
              <span>\${shortFile}:\${note.lineStart}-\${note.lineEnd}</span>
              <a class="open-link" data-action="open" data-file="\${encodeURIComponent(note.filePath)}" data-line="\${note.lineStart}">Open in Editor</a>
              <span>\${note.status}</span>
            </div>
          </div>
        \`;

        // toggle expand
        card.querySelector(".card-header").addEventListener("click", (e) => {
          if (e.target.closest(".card-actions")) return;
          if (expandedIds.has(note.id)) expandedIds.delete(note.id);
          else expandedIds.add(note.id);
          renderNotes();
        });

        // actions
        card.querySelectorAll("[data-action]").forEach(btn => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            if (action === "copy") copyNote(id);
            else if (action === "edit") openEdit(id);
            else if (action === "delete") requestDelete(id);
            else if (action === "open") {
              vscode.postMessage({
                type: "OPEN_FILE",
                payload: { filePath: decodeURIComponent(btn.dataset.file), line: parseInt(btn.dataset.line) }
              });
            }
          });
        });

        $notesList.appendChild(card);
      });
    }

    /* ── Message listener ── */
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg?.type) return;

      if (msg.type === "NOTES_UPDATED") {
        notes = msg.payload || [];
        renderNotes();
      }
      if (msg.type === "PONG") {
        showToast("PONG " + msg.at);
      }
      if (msg.type === "DUPLICATE_RESULT") {
        if (msg.payload.exists) {
          showToast("Note already exists for this selection!");
        }
      }
      if (msg.type === "SELECTION_READY") {
        pendingSelection = msg.payload;
        $cCode.textContent = msg.payload.codeSnippet || "";
        $cCode.style.color = "";
        // Switch to Notes tab if not already there
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        document.querySelector('[data-tab="notes"]').classList.add("active");
        document.getElementById("tab-notes").classList.add("active");
        // Scroll to composer
        document.getElementById("composer").scrollIntoView({ behavior: "smooth" });
        $cTitle.focus();
        showToast("Code selection loaded!");
      }
    });

    /* ── Keyboard shortcuts ── */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        $deleteModal.classList.remove("active");
        $editModal.classList.remove("active");
      }
    });

    /* ── Helpers ── */
    function uuid() {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
      });
    }

    function escapeHtml(str) {
      const div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    }

    function showToast(message) {
      $toast.textContent = message;
      $toast.classList.add("show");
      setTimeout(() => $toast.classList.remove("show"), 2500);
    }

    // initial render
    renderNotes();

    // request notes on load
    vscode.postMessage({ type: "GET_NOTES" });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
