import React from 'react';
import { Workbench } from './Workbench/Workbench';
import type { Folder, Chapter } from '../types';

interface ActiveScreenProps {
  onBack: () => void;
  folder?: Folder | null;
  chapter?: Chapter | null;
}

export const ActiveScreen: React.FC<ActiveScreenProps> = ({ 
  onBack, 
  folder = null, 
  chapter = null 
}) => {
  return <Workbench folder={folder} chapter={chapter} onBack={onBack} />;
};
