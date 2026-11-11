import React, { useState } from 'react';
import { focusRegistry } from '../../lib/focusRegistry';
import { CornerDownLeft, Delete } from 'lucide-react';
import { FloatingWindow } from './FloatingWindow';

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
  const [isShiftActive, setIsShiftActive] = useState(false);

  // Critical: key buttons call onMouseDown e.preventDefault() so active textarea focus stays intact
  const handleKeyClick = (char: string) => {
    focusRegistry.insertCharacter(char);
    onInsertChar?.(char);
  };

  const handleBackspace = () => {
    focusRegistry.backspace();
  };

  return (
    <FloatingWindow
      isOpen={isOpen}
      title="Arabic 101 Virtual Keyboard"
      storageKey="dragonfly44_keyboard_geom"
      defaultGeometry={{ x: 300, y: 340, width: 620, height: 320 }}
      minWidth={480}
      minHeight={230}
      minimizedWidth={340}
      closeTitle="Close (Ctrl+K)"
      onClose={onClose}
    >
      <div className="flex-1 min-h-0 p-2.5 flex flex-col justify-between gap-1.5 overflow-hidden text-xs">
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
              className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-amber-300 border border-white/[0.08] font-mono text-xs shrink-0 cursor-pointer active:scale-95"
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
                className="flex-1 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-white/[0.06] font-sans font-medium text-xs cursor-pointer active:scale-95 text-center"
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
            className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/[0.08] font-mono text-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95"
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
                className="flex-1 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-white/[0.06] font-sans font-medium text-xs cursor-pointer active:scale-95 text-center"
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
                className="flex-1 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-white/[0.06] font-sans font-medium text-xs cursor-pointer active:scale-95 text-center"
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
            className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/[0.08] font-mono text-xs flex items-center justify-center cursor-pointer active:scale-95"
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
            className={`px-3 py-1.5 rounded font-mono text-xs cursor-pointer ${
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
                className="flex-1 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-white/[0.06] font-sans font-medium text-xs cursor-pointer active:scale-95 text-center"
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
            className="w-full py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-white/[0.08] font-mono text-xs cursor-pointer text-center active:scale-[0.99]"
          >
            SPACEBAR
          </button>
        </div>
      </div>
    </FloatingWindow>
  );
};
