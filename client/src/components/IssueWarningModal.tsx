import React, { useState } from 'react';
import { X, ShieldAlert } from 'lucide-react';

interface IssueWarningModalProps {
  studentName: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (message: string) => void;
}

export const IssueWarningModal: React.FC<IssueWarningModalProps> = ({
  studentName,
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [message, setMessage] = useState('Please stay focused on the class.');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onSubmit(message.trim());
      setMessage('Please stay focused on the class.'); // Reset
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-800 bg-red-50 dark:bg-red-500/10">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <ShieldAlert className="w-5 h-5" />
            <h2 className="font-bold text-lg">Issue Strike Warning</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            You are issuing a warning to <span className="font-bold text-slate-900 dark:text-white">{studentName}</span>. This will appear prominently on their screen.
          </p>

          <div className="space-y-2 mb-6">
            <label htmlFor="warning-message" className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Warning Message
            </label>
            <textarea
              id="warning-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all resize-none outline-none"
              rows={3}
              placeholder="Enter warning message..."
              autoFocus
            />
          </div>

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!message.trim()}
              className="px-6 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-colors shadow-lg shadow-red-500/30"
            >
              Send Warning
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
