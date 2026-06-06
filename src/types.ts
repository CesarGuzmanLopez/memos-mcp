export const VALID_VISIBILITIES = ["PRIVATE", "PROTECTED", "PUBLIC"] as const;
export type Visibility = (typeof VALID_VISIBILITIES)[number];

export interface Memo {
  name: string;
  uid: string;
  rowStatus: string;
  creator: string;
  createTime: string;
  updateTime: string;
  content: string;
  visibility: Visibility;
  tags: string[];
  pinned: boolean;
  resources: unknown[];
  relations: unknown[];
  reactions: unknown[];
  property?: MemoProperty;
  parent?: string;
  snippet?: string;
}

export interface MemoProperty {
  hasLink: boolean;
  hasTaskList: boolean;
  hasCode: boolean;
  hasIncompleteTasks: boolean;
}
