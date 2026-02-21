import * as vscode from "vscode";
import * as path from "path";
import { DiaryNote } from "./types";

const FOLDER = ".dev-info-diary";
const FILE = "notes.json";

/**
 * Returns the Uri for the workspace-level notes.json,
 * creating the .dev-info-diary folder if it doesn't exist.
 * Returns null when no workspace folder is open.
 */
export async function getWorkspaceNotesPath(): Promise<vscode.Uri | null> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) {
    return null;
  }

  const folderUri = vscode.Uri.file(path.join(ws.uri.fsPath, FOLDER));
  const fileUri = vscode.Uri.file(path.join(folderUri.fsPath, FILE));

  try {
    await vscode.workspace.fs.stat(folderUri);
  } catch {
    await vscode.workspace.fs.createDirectory(folderUri);
  }

  return fileUri;
}

/**
 * Load notes from workspace file or globalState fallback.
 */
export async function loadNotes(context: vscode.ExtensionContext): Promise<DiaryNote[]> {
  const fileUri = await getWorkspaceNotesPath();

  if (fileUri) {
    try {
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const parsed = JSON.parse(Buffer.from(raw).toString("utf8"));
      if (Array.isArray(parsed)) {
        return parsed as DiaryNote[];
      }
      return [];
    } catch {
      return [];
    }
  }

  // fallback: no workspace open — use globalState
  return context.globalState.get<DiaryNote[]>("ddNotes", []);
}

/**
 * Persist notes to workspace file or globalState fallback.
 */
export async function saveNotes(
  context: vscode.ExtensionContext,
  notes: DiaryNote[]
): Promise<void> {
  const fileUri = await getWorkspaceNotesPath();

  if (fileUri) {
    const data = Buffer.from(JSON.stringify(notes, null, 2), "utf8");
    await vscode.workspace.fs.writeFile(fileUri, data);
    return;
  }

  await context.globalState.update("ddNotes", notes);
}
