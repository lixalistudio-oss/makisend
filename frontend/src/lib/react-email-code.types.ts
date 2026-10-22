export interface ReactEmailCodeSnapshot {
  html: string;
  text: string;
  variables: string[];
}

export interface ReactEmailCodeRequest {
  id: number;
  code: string;
}

export type ReactEmailCodeResponse =
  | ({ id: number; ok: true } & ReactEmailCodeSnapshot)
  | { id: number; ok: false; error: string };
