import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface EndSessionModalProps {
  isOpen: boolean;
  isProcessing?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const EndSessionModal: React.FC<EndSessionModalProps> = ({ isOpen, isProcessing = false, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0d1b2a]/80 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-start gap-4 p-6">
          <AlertTriangle className="w-8 h-8 text-red-500 mt-1 shrink-0" />
          <div className="flex-1">
            <h3 className="text-lg font-bold mb-2 text-slate-900 dark:text-white">End Session</h3>
            <p className="text-sm text-slate-700 dark:text-slate-300 mb-4">
              Are you sure you want to end this session for everyone? This will disconnect all participants.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={isProcessing}
                className={`px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg transition-colors ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {isProcessing ? 'Ending...' : 'End Session'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EndSessionModal;
