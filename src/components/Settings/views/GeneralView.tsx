import React from 'react';
import { Eye, EyeOff, Activity } from 'lucide-react';
import { SettingRow } from '../SettingRow';

export interface GeneralViewProps {
  getVal: <T>(key: string) => T;
  setVal: (key: string, val: any) => void;
  isKeyVisible: boolean;
  setIsKeyVisible: React.Dispatch<React.SetStateAction<boolean>>;
  connectionStatus: 'idle' | 'testing' | 'connected' | 'failed';
  pingMs: number | null;
  errorMessage: string | null;
  onTestConnection: () => void;
}

export const GeneralView: React.FC<GeneralViewProps> = ({
  getVal,
  setVal,
  isKeyVisible,
  setIsKeyVisible,
  connectionStatus,
  pingMs,
  errorMessage,
  onTestConnection,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono uppercase font-semibold tracking-wider text-zinc-100">
          General Preferences & API Vault
        </h2>
        <span className="text-xs text-zinc-500 font-mono">
          Global credentials and hardware telemetry
        </span>
      </div>

      <div className="space-y-1">
        {/* API Key Vault */}
        <SettingRow
          label="Gemini API Key"
          description="Authentication key for Google Gemini multimodal vision, OCR, and Arabic localization requests."
          layout="vertical"
        >
          <div className="relative flex items-center mt-1">
            <input
              type={isKeyVisible ? 'text' : 'password'}
              value={getVal<string>('general.gemini_api_key') || ''}
              onChange={(e) => setVal('general.gemini_api_key', e.target.value)}
              placeholder="Enter Gemini API key (AIzaSy...)"
              className="w-full pl-3 pr-10 py-2 rounded-md bg-[#050508] border border-white/[0.10] text-zinc-100 font-mono text-xs focus:outline-none focus:border-white/30"
            />
            <button
              type="button"
              onClick={() => setIsKeyVisible((prev) => !prev)}
              aria-label={isKeyVisible ? 'Hide API key' : 'Show API key'}
              className="absolute right-2.5 p-1 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              {isKeyVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </SettingRow>

        {/* Telemetry Ping */}
        <SettingRow
          label="Hardware Telemetry & Ping"
          description="Runs a direct latency handshake against the configured model endpoint to measure network round-trip time."
          layout="vertical"
        >
          <div className="flex items-center justify-between gap-4 p-3 rounded-md bg-[#09090c] border border-white/[0.06] mt-1">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-zinc-400" />
              <span className="text-xs font-mono text-zinc-300">
                {connectionStatus === 'idle' && 'Endpoint Idle'}
                {connectionStatus === 'testing' && 'Testing Connection...'}
                {connectionStatus === 'connected' && `Connected (${pingMs}ms)`}
                {connectionStatus === 'failed' && `Failed: ${errorMessage || 'Error'}`}
              </span>
            </div>
            <button
              type="button"
              onClick={onTestConnection}
              disabled={connectionStatus === 'testing'}
              className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-xs font-mono font-medium transition-colors cursor-pointer"
            >
              Test Connection
            </button>
          </div>
        </SettingRow>
      </div>
    </div>
  );
};
