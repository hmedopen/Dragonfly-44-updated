import React, { useState, useRef, useEffect } from 'react';
import { focusRegistry } from '../../lib/focusRegistry';
import { 
  X, 
  Minus, 
  Square, 
  CornerDownLeft, 
  Delete,
  GripHorizontal
} from 'lucide-react';

interface VirtualKeyboardProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertChar?: (char: string) => void;
}

const TASHKEEL_ROW = [
  { label: 'َ', name: 'Fatha', char: '\u064E' },
  { label: 'ً', name: 'Tanwin Fatha', char: '\u064B' },
  { label: 'ُ', name: 'Damma', char: '\u064F' },
  { label: 'ٌ', name: 'Tanwin Damma', char: '\u064C' },
  { label: 'ِ', name: 'Kasra', char: '\u0650' },
  { label: 'ٍ', name: 'Tanwin Kasra', char: '\u064D' },
  { label: 'ْ', name: 'Sukun', char: '\u0652' },
  { label: 'ّ', name: 'Shadda', char: '\u0651' },
  { label: 'ـ', name: 'Tatweel', char: '\u0640' },
  { label: '«', name: 'Open Quote', char: '«' },
  { label: '»', name: 'Close Quote', char: '»' },
  { label: '؟', name: 'Question Mark', char: '؟' },
  { label: '،', name: 'Comma', char: '،' },
  { label: '؛', name: 'Semicolon', char: '؛' },
  { label: '…', name: 'Ellipsis', char: '…' },
];

const ROW_1 = [
  { key: 'ذ', shift: 'ّ' },
  { key: '1', shift: '!' },
  { key: '2', shift: '@' },
  { key: '3', shift: '#' },
  { key: '4', shift: '$' },
  { key: '5', shift: '%' },
  { key: '6', shift: '^' },
  { key: '7', shift: '&' },
  { key: '8', shift: '*' },
  { key: '9', shift: ')' },
  { key: '0', shift: '(' },
  { key: '-', shift: '_' },
  { key: '=', shift: '+' },
];

const ROW_2 = [
  { key: 'ض', shift: 'َ' },
  { key: 'ص', shift: 'ً' },
  { key: 'ث', shift: 'ُ' },
  { key: 'ق', shift: 'ٌ' },
  { key: 'ف', shift: 'لإ' },
  { key: 'غ', shift: 'إ' },
  { key: 'ع', shift: '‘' },
  { key: 'ه', shift: '÷' },
  { key: 'خ', shift: '×' },
  { key: 'ح', shift: '؛' },
  { key: 'ج', shift: '<' },
  { key: 'د', shift: '>' },
];

const ROW_3 = [
  { key: 'ش', shift: 'ِ' },
  { key: 'س', shift: 'ٍ' },
  { key: 'ي', shift: ']' },
  { key: 'ب', shift: '[' },
  { key: 'ل', shift: 'لأ' },
  { key: 'ا', shift: 'أ' },
  { key: 'ت', shift: 'ـ' },
  { key: 'ن', shift: '،' },
  { key: 'م', shift: '/' },
  { key: 'ك', shift: ':' },
  { key: 'ط', shift: '"' },
];

const ROW_4 = [
  { key: 'ئ', shift: '~' },
  { key: 'ء', shift: 'ْ' },
  { key: 'ؤ', shift: '}' },
  { key: 'ر', shift: '{' },
  { key: 'ى', shift: 'آ' },
  { key: 'ة', shift: '’' },
  { key: 'و', shift: ',' },
  { key: 'ز', shift: '.' },
  { key: 'ظ', shift: '؟' },
];

export const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({
  isOpen,
  onClose,
  onInsertChar,
}) => {
  // Load persisted geometry
  const [geometry, setGeometry] = useState(() => {
    try {
      const saved = localStorage.getItem('dragonfly44_keyboard_geom');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { x: 300, y: 340, width: 620, height: 320 };
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 620, height: 320 });
  const [isMinimized, setIsMinimized] = useState(false);
  const [isShiftActive, setIsShiftActive] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Persist geometry changes
  useEffect(() => {
    localStorage.setItem('dragonfly44_keyboard_geom', JSON.stringify(geometry));
  }, [geometry]);

  // Window drag handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setGeometry((prev: any) => ({
          ...prev,
          x: Math.max(10, Math.min(window.innerWidth - 300, e.clientX - dragOffset.x)),
          y: Math.max(10, Math.min(window.innerHeight - 80, e.clientY - dragOffset.y)),
        }));
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStart.x;
        const deltaY = e.clientY - resizeStart.y;
        setGeometry((prev: any) => ({
          ...prev,
          width: Math.max(480, Math.min(window.innerWidth - prev.x - 20, resizeStart.width + deltaX)),
          height: Math.max(220, Math.min(window.innerHeight - prev.y - 20, resizeStart.height + deltaY)),
        }));
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, dragOffset, resizeStart]);

  if (!isOpen) return null;

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - geometry.x,
      y: e.clientY - geometry.y,
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: geometry.width,
      height: geometry.height,
    });
  };

  // Critical: onMouseDown calls preventDefault to never steal focus
  const handleKeyClick = (char: string) => {
    focusRegistry.insertCharacter(char);
    onInsertChar?.(char);
  };

  const handleBackspace = () => {
    focusRegistry.backspace();
  };

  return (
    <div
      ref={containerRef}
      style={{
        left: `${geometry.x}px`,
        top: `${geometry.y}px`,
        width: `${geometry.width}px`,
      }}
      className="fixed z-50 flex flex-col rounded-xl border border-white/[0.14] bg-[#0c0c11]/95 backdrop-blur-md shadow-2xl select-none overflow-hidden animate-in fade-in duration-150"
    >
      {/* 1. Header Drag Bar */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="h-9 px-3 bg-[#08080b] border-b border-white/[0.08] flex items-center justify-between cursor-move shrink-0"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="w-3.5 h-3.5 text-zinc-500" />
          <span className="font-mono text-xs font-semibold text-zinc-200 tracking-wider uppercase">
            Arabic 101 Virtual Keyboard
          </span>
        </div>

        <div className="flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setIsMinimized((prev) => !prev)}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? <Square className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Close (Ctrl+K)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Keyboard Body */}
      {!isMinimized && (
        <div
          style={{ height: `${geometry.height - 36}px` }}
          className="p-2.5 flex flex-col justify-between gap-1.5 overflow-hidden text-xs relative"
        >
          {/* Tashkeel & Scanlation Punctuation Strip */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 custom-scrollbar">
            {TASHKEEL_ROW.map((item) => (
              <button
                key={item.name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleKeyClick(item.char);
                }}
                title={item.name}
                className="px-2 py-1 rounded bg-zinc-900/90 hover:bg-zinc-800 text-amber-300 border border-white/[0.08] font-mono text-xs transition-colors shrink-0 cursor-pointer active:scale-95"
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Row 1 */}
          <div className="flex items-center gap-1">
            {ROW_1.map((item) => {
              const displayChar = isShiftActive ? item.shift : item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleKeyClick(displayChar);
                  }}
                  className="flex-1 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-white/[0.06] font-sans font-medium text-xs transition-colors cursor-pointer active:scale-95 text-center"
                >
                  {displayChar}
                </button>
              );
            })}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleBackspace();
              }}
              className="px-3 py-1.5 rounded bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-white/[0.08] font-mono text-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95"
              title="Backspace"
            >
              <Delete className="w-3 h-3" />
            </button>
          </div>

          {/* Row 2 */}
          <div className="flex items-center gap-1">
            {ROW_2.map((item) => {
              const displayChar = isShiftActive ? item.shift : item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleKeyClick(displayChar);
                  }}
                  className="flex-1 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-white/[0.06] font-sans font-medium text-xs transition-colors cursor-pointer active:scale-95 text-center"
                >
                  {displayChar}
                </button>
              );
            })}
          </div>

          {/* Row 3 */}
          <div className="flex items-center gap-1">
            {ROW_3.map((item) => {
              const displayChar = isShiftActive ? item.shift : item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleKeyClick(displayChar);
                  }}
                  className="flex-1 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-white/[0.06] font-sans font-medium text-xs transition-colors cursor-pointer active:scale-95 text-center"
                >
                  {displayChar}
                </button>
              );
            })}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleKeyClick('\n');
              }}
              className="px-3 py-1.5 rounded bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-white/[0.08] font-mono text-xs flex items-center justify-center cursor-pointer active:scale-95"
              title="Enter"
            >
              <CornerDownLeft className="w-3 h-3" />
            </button>
          </div>

          {/* Row 4 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsShiftActive((prev) => !prev);
              }}
              className={`px-3 py-1.5 rounded font-mono text-xs transition-colors cursor-pointer ${
                isShiftActive
                  ? 'bg-amber-500 text-zinc-950 font-bold border border-amber-400'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/[0.08]'
              }`}
            >
              Shift
            </button>
            {ROW_4.map((item) => {
              const displayChar = isShiftActive ? item.shift : item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleKeyClick(displayChar);
                  }}
                  className="flex-1 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-white/[0.06] font-sans font-medium text-xs transition-colors cursor-pointer active:scale-95 text-center"
                >
                  {displayChar}
                </button>
              );
            })}
          </div>

          {/* Bottom Bar: Spacebar */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleKeyClick(' ');
              }}
              className="w-full py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-white/[0.08] font-mono text-xs transition-colors cursor-pointer text-center active:scale-[0.99]"
            >
              SPACEBAR
            </button>
          </div>

          {/* Resizable Corner Grip Handle */}
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-se-resize flex items-center justify-center opacity-60 hover:opacity-100"
            title="Drag to resize"
          >
            <div className="w-2 h-2 border-r-2 border-b-2 border-zinc-500" />
          </div>
        </div>
      )}
    </div>
  );
};
