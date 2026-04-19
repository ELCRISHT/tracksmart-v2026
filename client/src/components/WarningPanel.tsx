/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import { socket } from '../lib/socket';
import { ShieldAlert, CheckCircle, Shield, AlertTriangle } from 'lucide-react';

interface WarningPanelProps {
  score: number;
  myIdentity: string | null; // Required to filter attention updates to self only
}

export const WarningPanel: React.FC<WarningPanelProps> = ({ score, myIdentity }) => {
  const [warnings, setWarnings] = useState<string[]>([]);
  const [activeWarning, setActiveWarning] = useState<string | null>(null);
  const [warningCount, setWarningCount] = useState(0);

  useEffect(() => {
    const handleStudentAlert = (data: any) => {
      console.log('[WarningPanel] Received student_alert:', data.alertType, data);
      
      if (data.alertType === 'phone_detected') {
        setActiveWarning("📱 Mobile Device Detected! Please put your phone away.");
        console.warn('[WarningPanel] 🚨 PHONE DETECTED');
      } else if (data.alertType === 'phone_cleared') {
        console.log('[WarningPanel] ✅ Phone cleared');
        setActiveWarning(null);
      } else if (data.alertType === 'distraction') {
        if (data.type === 'looking_away') {
          setActiveWarning("You're Looking Away! Focus on the screen.");
          console.warn('[WarningPanel] LOOKING AWAY');
        } else if (data.type === 'no_face') {
          setActiveWarning("Face Not Detected! Stay in frame please.");
          console.warn('[WarningPanel] NO FACE DETECTED');
        }
      } else if (data.alertType === 'tab_switch') {
        setActiveWarning("Tab Switch Detected! Stay focused on this window.");
        console.warn('[WarningPanel] TAB SWITCH DETECTED');
      }
      
      if (data.warningCount !== undefined) {
        setWarningCount(data.warningCount);
      }
    };

    const handleAttentionUpdate = (data: any) => {
      // Only update warning count for THIS student, not for others in the room
      if (myIdentity && data.studentId !== myIdentity) return;
      
      console.debug('[WarningPanel] attention_update:', { score: data.score, warningCount: data.warningCount, studentId: data.studentId });
      
      if (data.warningCount !== undefined) {
        setWarningCount(data.warningCount);
      }
    };

    const handleWarningIssued = (data: any) => {
      console.warn('[WarningPanel] Teacher issued warning:', data.message);
      setActiveWarning(data.message);
      setWarnings(prev => [data.message, ...prev]);
    };

    socket.on('ts:student_alert', handleStudentAlert);
    socket.on('ts:attention_update', handleAttentionUpdate);
    socket.on('ts:warning_issued', handleWarningIssued);

    return () => {
      socket.off('ts:student_alert', handleStudentAlert);
      socket.off('ts:attention_update', handleAttentionUpdate);
      socket.off('ts:warning_issued', handleWarningIssued);
    };
  }, [myIdentity]);

  const handleCompliance = () => {
    setActiveWarning(null);
    socket.emit('ts:complied', { timestamp: Date.now() });
  };

  const isCritical = warnings.length >= 3;
  const isWarning = activeWarning !== null;
  
  let stateClass = "bg-track-teal/10 border-track-teal/30 text-track-teal";
  let Icon = Shield;
  let statusText = "You're attentive";
  let subText = "Keep it up!";

  if (isCritical) {
    stateClass = "bg-track-alert-red/10 border-track-alert-red/30 text-track-alert-red";
    Icon = ShieldAlert;
    statusText = "Critical Warning";
    subText = "Teacher notified.";
  } else if (isWarning) {
    stateClass = "bg-track-alert-amber/10 border-track-alert-amber/30 text-track-alert-amber";
    Icon = AlertTriangle;
    statusText = "Action Required";
    subText = "Review warnings below.";
  }

  return (
    <div className="p-4 flex-1 flex flex-col w-full h-full">
      {/* Header Status Block */}
      <div className={`border p-4 rounded-xl mb-4 text-center transition-colors duration-500 relative overflow-hidden ${stateClass}`}>
        <div className="absolute top-2 right-3 flex gap-0.5">
           {[...Array(Math.min(5, warningCount))].map((_, i) => (
             <span key={i} className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.5)]"></span>
           ))}
        </div>
        <Icon className="w-8 h-8 mx-auto mb-2 opacity-80" />
        <h3 className="font-bold mb-1">{statusText}</h3>
        <p className="text-xs opacity-75">{subText} ({warningCount} Warnings)</p>
      </div>
      
      {/* Active Warning Action (If any) */}
      {isWarning && (
        <div className="bg-track-alert-amber rounded-xl p-4 mb-4 text-slate-900 shadow-lg animate-pulse border-2 border-amber-400">
          <p className="font-bold text-sm mb-3">⚠️ {activeWarning}</p>
          <button 
            onClick={handleCompliance}
            className="w-full bg-slate-900 hover:bg-slate-800 text-amber-400 font-bold py-2 rounded-lg transition-colors text-sm"
          >
            I'm Back
          </button>
        </div>
      )}

      <div className="my-6 bg-slate-800 p-4 rounded-xl border border-slate-700">
        <div className="flex justify-between text-xs text-slate-400 mb-2 font-medium">
          <span>Attention Score</span>
          <span className={`${score > 80 ? 'text-track-teal' : score > 50 ? 'text-track-alert-amber' : 'text-track-alert-red'} font-bold`}>
            {Math.round(score)}%
          </span>
        </div>
        <div className="h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-700/50">
          <div 
            className={`h-full rounded-full transition-all duration-1000 ${
              score > 80 ? 'bg-track-teal' : score > 50 ? 'bg-track-alert-amber' : 'bg-track-alert-red'
            }`} 
            style={{ width: `${score}%` }}
          ></div>
        </div>
      </div>

      <div className="mt-auto">
        <h4 className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-3 border-b border-slate-800 pb-2">Active Monitors</h4>
        <ul className="text-sm text-slate-400 space-y-2.5">
          <li className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-track-teal" />
            Face &amp; Gaze Tracking
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-track-teal" />
            Device Detection
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-track-teal" />
            Tab Focus Tracking
          </li>
        </ul>
      </div>

      {/* Event Logs */}
      {warnings.length > 0 && (
        <div className="mt-6 border-t border-slate-800 pt-4">
          <h4 className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-3">Session Log</h4>
          <div className="space-y-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
            {warnings.map((w, i) => (
              <div key={i} className="text-xs text-slate-300 bg-slate-800/50 p-2 rounded border border-slate-700/50 flex items-start gap-2">
                <span className="text-slate-500 mt-0.5">•</span>
                {w}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WarningPanel;
