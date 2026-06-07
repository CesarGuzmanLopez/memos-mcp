export const VALID_VISIBILITIES = ["PRIVATE", "PROTECTED", "PUBLIC"] as const;
export type Visibility = (typeof VALID_VISIBILITIES)[number];

export interface Attachment {
  name: string;
  filename: string;
  type: string;
  size: string;
  createTime: string;
  externalLink?: string;
  uiResourcePath?: string;
}

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
  attachments: Attachment[];
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
