import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Maximize2,
  Minimize2,
  Tag,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { TrainingVisualAnnotation, VisualAnnotationRelation } from '../../types/training';

interface AnnotationCanvasProps {
  imageBlob: Blob | null;
  annotations: TrainingVisualAnnotation[];
  onChangeAnnotations: (annotations: TrainingVisualAnnotation[]) => void;
  onClose: () => void;
  exampleTitle: string;
  orderIndex: number;
}

const LABEL_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  balloon: { bg: 'bg-sky-500/20', border: 'border-sky-400', text: 'text-sky-300' },
  tail: { bg: 'bg-purple-500/20', border: 'border-purple-400', text: 'text-purple-300' },
  text_region: { bg: 'bg-amber-500/20', border: 'border-amber-400', text: 'text-amber-300' },
  sfx: { bg: 'bg-emerald-500/20', border: 'border-emerald-400', text: 'text-emerald-300' },
  panel: { bg: 'bg-zinc-500/20', border: 'border-zinc-400', text: 'text-zinc-300' },
  character: { bg: 'bg-rose-500/20', border: 'border-rose-400', text: 'text-rose-300' },
  other: { bg: 'bg-blue-500/20', border: 'border-blue-400', text: 'text-blue-300' },
};

export const AnnotationCanvas: React.FC<AnnotationCanvasProps> = ({
  imageBlob,
  annotations,
  onChangeAnnotations,
  onClose,
  exampleTitle,
  orderIndex,
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<[number, number, number, number] | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!imageBlob) return;
    const url = URL.createObjectURL(imageBlob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageBlob]);

  const selectedAnnotation = annotations.find((a) => a.id === selectedAnnId) || null;

  // Convert mouse event coordinates to normalized 0-1000 box
  const getNormalizedPoint = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current) return null;
    const rect = imageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const normX = Math.round((x / rect.width) * 1000);
    const normY = Math.round((y / rect.height) * 1000);
    return { x: normX, y: normY };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only primary click
    const p = getNormalizedPoint(e);
    if (!p) return;

    setIsDrawing(true);
    setDrawStart(p);
    setCurrentBox([p.y, p.x, p.y, p.x]);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawStart) return;
    const p = getNormalizedPoint(e);
    if (!p) return;

    const ymin = Math.min(drawStart.y, p.y);
    const xmin = Math.min(drawStart.x, p.x);
    const ymax = Math.max(drawStart.y, p.y);
    const xmax = Math.max(drawStart.x, p.x);

    setCurrentBox([ymin, xmin, ymax, xmax]);
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentBox) {
      setIsDrawing(false);
      setDrawStart(null);
      return;
    }

    const [ymin, xmin, ymax, xmax] = currentBox;
    // Minimum box threshold (at least 10x10 normalized units)
    if (ymax - ymin > 10 && xmax - xmin > 10) {
      const now = Date.now();
      const count = annotations.length + 1;
      const newAnn: TrainingVisualAnnotation = {
        id: `ann_${now}_${count}`,
        physicalObjectId: `balloon_${count}`,
        box_2d: [ymin, xmin, ymax, xmax],
        label: 'balloon',
        translationUnitId: `TU_1`,
        readingOrderIndex: count,
        relationships: [],
        notes: '',
        isVerified: true, // Drawn by developer directly = verified
        source: 'user',
      };

      onChangeAnnotations([...annotations, newAnn]);
      setSelectedAnnId(newAnn.id);
    }

    setIsDrawing(false);
    setDrawStart(null);
    setCurrentBox(null);
  };

  const handleUpdateSelected = (patch: Partial<TrainingVisualAnnotation>) => {
    if (!selectedAnnId) return;
    const updated = annotations.map((a) => (a.id === selectedAnnId ? { ...a, ...patch } : a));
    onChangeAnnotations(updated);
  };

  const handleDeleteSelected = () => {
    if (!selectedAnnId) return;
    const updated = annotations.filter((a) => a.id !== selectedAnnId);
    onChangeAnnotations(updated);
    setSelectedAnnId(null);
  };

  const handleAddRelation = (targetId: string, relType: VisualAnnotationRelation['relationType']) => {
    if (!selectedAnnotation || !targetId) return;
    const currentRels = selectedAnnotation.relationships || [];
    const updatedRels = [...currentRels, { targetObjectId: targetId, relationType: relType }];
    handleUpdateSelected({ relationships: updatedRels });
  };

  const handleRemoveRelation = (idx: number) => {
    if (!selectedAnnotation || !selectedAnnotation.relationships) return;
    const updated = selectedAnnotation.relationships.filter((_, i) => i !== idx);
    handleUpdateSelected({ relationships: updated });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-6xl h-[92vh] bg-[#0c0d12] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans">
        {/* Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold">
              #{String(orderIndex).padStart(2, '0')}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">
                VISUAL ANNOTATIONS STUDIO // {exampleTitle}
              </h2>
              <p className="text-[11px] text-zinc-500">
                Draw and configure bounding boxes. Distinguish physical balloon identity from translation unit groupings.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-zinc-900 border border-white/[0.08] rounded-lg p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.2))}
                className="px-2 py-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
                title="Zoom Out"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono text-[11px] text-zinc-400">{Math.round(zoomLevel * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(2.0, z + 0.2))}
                className="px-2 py-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
                title="Zoom In"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel(1)}
                className="px-2 py-1 text-zinc-500 hover:text-zinc-300 font-mono text-[10px]"
              >
                Reset
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Studio Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main Visual Canvas Pane */}
          <div
            ref={containerRef}
            className="flex-1 bg-[#060608] relative overflow-auto flex items-center justify-center p-4"
          >
            {imageUrl ? (
              <div
                className="relative inline-block select-none shadow-2xl border border-white/[0.08] rounded"
                style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              >
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt={exampleTitle}
                  className="max-h-[75vh] w-auto pointer-events-none block"
                  draggable={false}
                />

                {/* Render Existing Annotations */}
                {annotations.map((ann) => {
                  const [ymin, xmin, ymax, xmax] = ann.box_2d;
                  const top = `${(ymin / 10).toFixed(2)}%`;
                  const left = `${(xmin / 10).toFixed(2)}%`;
                  const height = `${((ymax - ymin) / 10).toFixed(2)}%`;
                  const width = `${((xmax - xmin) / 10).toFixed(2)}%`;

                  const isSelected = ann.id === selectedAnnId;
                  const colorConfig = LABEL_COLORS[ann.label] || LABEL_COLORS.other;

                  return (
                    <div
                      key={ann.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAnnId(ann.id);
                      }}
                      className={`absolute cursor-pointer transition-all border-2 rounded ${
                        isSelected
                          ? 'border-white ring-2 ring-amber-400 shadow-lg z-30'
                          : `${colorConfig.border} ${colorConfig.bg} hover:border-white/80 z-20`
                      }`}
                      style={{ top, left, width, height }}
                    >
                      {/* Badge Tag */}
                      <div className="absolute -top-6 left-0 flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/90 border border-white/20 whitespace-nowrap shadow-md">
                        {ann.isVerified ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-amber-400 animate-pulse" />
                        )}
                        <span className="font-bold text-white">{ann.physicalObjectId}</span>
                        {ann.translationUnitId && (
                          <span className="text-zinc-400">[{ann.translationUnitId}]</span>
                        )}
                        {typeof ann.readingOrderIndex === 'number' && (
                          <span className="text-amber-400 font-semibold">#{ann.readingOrderIndex}</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Active Drawing Box */}
                {isDrawing && currentBox && (
                  <div
                    className="absolute border-2 border-amber-400 bg-amber-500/25 pointer-events-none rounded z-40"
                    style={{
                      top: `${(currentBox[0] / 10).toFixed(2)}%`,
                      left: `${(currentBox[1] / 10).toFixed(2)}%`,
                      height: `${((currentBox[2] - currentBox[0]) / 10).toFixed(2)}%`,
                      width: `${((currentBox[3] - currentBox[1]) / 10).toFixed(2)}%`,
                    }}
                  />
                )}
              </div>
            ) : (
              <div className="text-center text-zinc-500">Loading screenshot image...</div>
            )}
          </div>

          {/* Right Inspector Sidebar */}
          <div className="w-96 border-l border-white/[0.08] bg-[#09090d] flex flex-col overflow-y-auto">
            <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
                Annotation Inspector
              </span>
              <span className="text-[11px] font-mono text-zinc-500">
                {annotations.length} box{annotations.length !== 1 ? 'es' : ''}
              </span>
            </div>

            {selectedAnnotation ? (
              <div className="p-4 space-y-4 text-xs">
                {/* Verification Status */}
                <div
                  className={`p-3 rounded-lg border flex items-center justify-between ${
                    selectedAnnotation.isVerified
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-950/20 border-amber-500/30 text-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {selectedAnnotation.isVerified ? (
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    )}
                    <div>
                      <div className="font-semibold">
                        {selectedAnnotation.isVerified ? 'Approved Ground Truth' : 'Unverified Suggestion'}
                      </div>
                      <div className="text-[10px] text-zinc-400">Source: {selectedAnnotation.source}</div>
                    </div>
                  </div>

                  {!selectedAnnotation.isVerified ? (
                    <button
                      type="button"
                      onClick={() => handleUpdateSelected({ isVerified: true })}
                      className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[10px] font-semibold transition-colors"
                    >
                      Approve
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleUpdateSelected({ isVerified: false })}
                      className="text-zinc-500 hover:text-zinc-300 text-[10px] font-mono underline"
                    >
                      Unverify
                    </button>
                  )}
                </div>

                {/* Physical Object ID */}
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                    Physical Object ID (Mandatory)
                  </label>
                  <input
                    type="text"
                    value={selectedAnnotation.physicalObjectId}
                    onChange={(e) => handleUpdateSelected({ physicalObjectId: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-white/[0.1] text-zinc-100 font-mono text-xs focus:border-amber-400 focus:outline-none"
                    placeholder="e.g. balloon_1, tail_1"
                  />
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Identifies this physical drawn contour in the illustration.
                  </p>
                </div>

                {/* Label Category */}
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">Visual Class Label</label>
                  <select
                    value={selectedAnnotation.label}
                    onChange={(e) => handleUpdateSelected({ label: e.target.value as any })}
                    className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-white/[0.1] text-zinc-100 text-xs focus:border-amber-400 focus:outline-none"
                  >
                    <option value="balloon">Speech / Thought Balloon</option>
                    <option value="tail">Balloon Tail / Pointer</option>
                    <option value="text_region">Text Region (Floating / Untethered)</option>
                    <option value="sfx">Sound Effect (SFX)</option>
                    <option value="panel">Panel Boundary</option>
                    <option value="character">Character Reference</option>
                    <option value="other">Other Visual Region</option>
                  </select>
                </div>

                {/* Translation Unit Association */}
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                    Translation Unit Association (TU)
                  </label>
                  <input
                    type="text"
                    value={selectedAnnotation.translationUnitId || ''}
                    onChange={(e) => handleUpdateSelected({ translationUnitId: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-white/[0.1] text-zinc-100 font-mono text-xs focus:border-amber-400 focus:outline-none"
                    placeholder="e.g. TU_1"
                  />
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Crucial for double balloons: links separate physical balloons to one logical sentence.
                  </p>
                </div>

                {/* Reading Order Sequence */}
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">Expected Reading Order (#)</label>
                  <input
                    type="number"
                    min="1"
                    value={selectedAnnotation.readingOrderIndex || 1}
                    onChange={(e) => handleUpdateSelected({ readingOrderIndex: parseInt(e.target.value) || 1 })}
                    className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-white/[0.1] text-zinc-100 font-mono text-xs focus:border-amber-400 focus:outline-none"
                  />
                </div>

                {/* Normalized Coordinates */}
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                    Normalized Box [ymin, xmin, ymax, xmax]
                  </label>
                  <div className="font-mono text-[11px] text-zinc-300 bg-zinc-900/80 px-2.5 py-1.5 rounded border border-white/[0.06]">
                    [{selectedAnnotation.box_2d.join(', ')}]
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">Annotation Guidance Note</label>
                  <textarea
                    rows={2}
                    value={selectedAnnotation.notes || ''}
                    onChange={(e) => handleUpdateSelected({ notes: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-white/[0.1] text-zinc-100 text-xs focus:border-amber-400 focus:outline-none resize-none"
                    placeholder="Specific advice to the AI regarding this balloon or tail..."
                  />
                </div>

                {/* Relationships */}
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">Relationships & Links</label>
                  <div className="space-y-1.5 mb-2">
                    {(selectedAnnotation.relationships || []).map((rel, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-2 py-1 bg-zinc-900/60 rounded border border-white/[0.06] text-[11px] font-mono"
                      >
                        <span className="text-zinc-300">
                          {rel.relationType} → <span className="text-amber-400">{rel.targetObjectId}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveRelation(idx)}
                          className="text-zinc-500 hover:text-rose-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add Relationship */}
                  <div className="flex items-center gap-1.5">
                    <select
                      id="newRelTarget"
                      className="flex-1 px-2 py-1 rounded bg-zinc-900 border border-white/[0.1] text-[11px] font-mono text-zinc-300"
                    >
                      <option value="">Select target balloon...</option>
                      {annotations
                        .filter((a) => a.id !== selectedAnnotation.id)
                        .map((a) => (
                          <option key={a.id} value={a.physicalObjectId}>
                            {a.physicalObjectId}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const sel = document.getElementById('newRelTarget') as HTMLSelectElement;
                        if (sel && sel.value) {
                          handleAddRelation(sel.value, 'connected_tail');
                          sel.value = '';
                        }
                      }}
                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-mono text-zinc-200 border border-white/[0.08]"
                    >
                      Link
                    </button>
                  </div>
                </div>

                {/* Delete Annotation Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 font-mono text-xs transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Annotation
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-500">
                <Tag className="w-8 h-8 mb-2 text-zinc-600" />
                <p className="text-xs font-semibold text-zinc-400">No Box Selected</p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Click an existing box on the screenshot, or click and drag to draw a new bounding box.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
