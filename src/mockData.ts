import type { Folder } from './types';

export const initialFolders: Folder[] = [
  {
    id: 'folder-drafts',
    name: 'drafts',
    badgeCount: 0,
    createdAt: Date.now(),
    isSystem: true,
    chapters: [],
  },
];
