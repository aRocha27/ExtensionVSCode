export type Priority = 1 | 2 | 3 | 4 | 5;

export interface DiaryNote {
  id: string;               // uuid
  title: string;
  filePath: string;         // fs path
  lineStart: number;        // 1-based
  lineEnd: number;          // 1-based
  codeSnippet: string;
  description: string;
  tags: string[];
  priority: Priority;
  status: "Commented" | "Uncommented";
  createdAt: string;        // ISO
  updatedAt: string;        // ISO
}

