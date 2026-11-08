import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { isTrainingStudioEnabled } from '../../lib/training/env';
import { TrainingStudioScreen } from './TrainingStudioScreen';

interface TrainingStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TrainingStudioModal: React.FC<TrainingStudioModalProps> = ({ isOpen, onClose }) => {
  // ESC shortcut to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !isTrainingStudioEnabled()) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-6xl h-[92vh] bg-[#0c0d12] border border-white/[0.14] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans relative">
        {/* Floating Close Button in Header */}
        <div className="absolute top-3 right-4 z-40">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer bg-black/40 border border-white/[0.08]"
            title="Close Training Studio (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Training Studio Screen */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <TrainingStudioScreen />
        </div>
      </div>
    </div>
  );
};
