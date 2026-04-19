import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, Download, Users, AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import jsPDF from 'jspdf';

interface SessionData {
  title: string;
  created_at: any;
  room_code: string;
}

interface StudentReport {
  id: string;
  name: string;
  avgScore: number;
  timeAwayMs: number;
  warnings: number;
  events?: Array<{ type: string; timestamp: any; details?: string }>;
}

const SessionReport: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionData | null>(null);
  const [reports, setReports] = useState<StudentReport[]>([]);
  const [stats, setStats] = useState({
    totalStudents: 0,
    avgAttention: 0,
    totalWarnings: 0
  });

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      try {
        setLoading(true);
        // 1. Fetch Session Info
        const sessionDoc = await getDoc(doc(db, 'sessions', id));
        if (!sessionDoc.exists()) {
          console.error("Session not found");
          navigate('/dashboard');
          return;
        }
        const sData = sessionDoc.data() as SessionData;
        setSession(sData);

        // 2. Fetch participants to get student names
        const participantsQuery = query(
          collection(db, 'participants'),
          where('session_id', '==', id)
        );
        const participantsSnapshot = await getDocs(participantsQuery);
        const participantMap: Record<string, string> = {};
        participantsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          participantMap[doc.id] = data.display_name || data.name || 'Unknown Student';
        });

        // 3. Fetch all events for this session
        const eventsQuery = query(
          collection(db, 'session_events'),
          where('session_id', '==', id)
        );
        const eventsSnapshot = await getDocs(eventsQuery);
        const events = eventsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 4. Process Data
        const studentMap: Record<string, { 
          name: string; 
          scores: number[]; 
          warnings: number; 
          awayStart: number | null; 
          totalAwayMs: number;
          events: Array<{ type: string; timestamp: any; details?: string }>;
        }> = {};

        events.forEach((event: any) => {
          if (!event.student_id) return;
          
          if (!studentMap[event.student_id]) {
            studentMap[event.student_id] = { 
              name: participantMap[event.student_id] || event.payload?.displayName || 'Unknown Student', 
              scores: [], 
              warnings: 0, 
              awayStart: null, 
              totalAwayMs: 0,
              events: []
            };
          }

          const s = studentMap[event.student_id];
          
          if (event.event_type === 'attention_update' && event.payload?.score !== undefined) {
            s.scores.push(event.payload.score);
            s.events.push({
              type: 'Attention Update',
              timestamp: event.timestamp,
              details: `Score: ${event.payload.score}%`
            });
          } else if (event.event_type === 'warning_issued') {
            s.warnings++;
            s.events.push({
              type: 'Warning Issued',
              timestamp: event.timestamp,
              details: event.payload?.message || 'Warning issued'
            });
          } else if (event.event_type === 'phone_detected') {
            s.warnings++;
            s.events.push({
              type: 'Phone Detected',
              timestamp: event.timestamp,
              details: 'Mobile device detected'
            });
          } else if (event.event_type === 'tab_switch' || event.event_type === 'distraction') {
            s.awayStart = event.timestamp?.toMillis ? event.timestamp.toMillis() : Date.now();
            s.events.push({
              type: event.event_type === 'tab_switch' ? 'Tab Switch' : 'Distraction Detected',
              timestamp: event.timestamp
            });
          } else if (event.event_type === 'tab_return' || event.event_type === 'student_joined') {
            if (s.awayStart) {
              const end = event.timestamp?.toMillis ? event.timestamp.toMillis() : Date.now();
              s.totalAwayMs += (end - s.awayStart);
              s.awayStart = null;
            }
            s.events.push({
              type: event.event_type === 'tab_return' ? 'Tab Return' : 'Student Joined',
              timestamp: event.timestamp
            });
          }
        });

        const processedReports: StudentReport[] = Object.entries(studentMap).map(([sid, data]) => ({
          id: sid,
          name: data.name,
          avgScore: data.scores.length > 0 ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : 100,
          timeAwayMs: data.totalAwayMs,
          warnings: data.warnings,
          events: data.events
        }));

        setReports(processedReports);
        
        const totalW = processedReports.reduce((sum, r) => sum + r.warnings, 0);
        const totalAvg = processedReports.length > 0 
          ? Math.round(processedReports.reduce((sum, r) => sum + r.avgScore, 0) / processedReports.length)
          : 0;

        setStats({
          totalStudents: processedReports.length,
          avgAttention: totalAvg,
          totalWarnings: totalW
        });

      } catch (err) {
        console.error("Failed to fetch report data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, navigate]);

  const exportSummaryCSV = () => {
    const headers = ['Student Name', 'Avg Attention (%)', 'Time Away (s)', 'Warnings'];
    const rows = reports.map(r => [
      r.name,
      r.avgScore,
      Math.round(r.timeAwayMs / 1000),
      r.warnings
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `TrackSmart_Summary_Report_${session?.room_code || id}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportIndividualReport = (student: StudentReport) => {
    const timestamp = session?.created_at 
      ? new Date(session.created_at.toMillis ? session.created_at.toMillis() : session.created_at).toLocaleString()
      : new Date().toLocaleString();

    // Calculate warning breakdown
    const warningEvents = student.events?.filter(e => e.type.includes('Warning') || e.type === 'Phone Detected' || e.type === 'Distraction Detected') || [];
    const attentionUpdates = student.events?.filter(e => e.type === 'Attention Update') || [];
    const minScore = attentionUpdates.length > 0 
      ? Math.min(...attentionUpdates.map(e => {
          const match = e.details?.match(/Score: (\d+)%/);
          return match ? parseInt(match[1]) : 100;
        }))
      : 100;
    const maxScore = attentionUpdates.length > 0
      ? Math.max(...attentionUpdates.map(e => {
          const match = e.details?.match(/Score: (\d+)%/);
          return match ? parseInt(match[1]) : 100;
        }))
      : 100;

    // Create CSV content
    const csvLines: string[] = [];
    csvLines.push(`TrackSmart Individual Student Report`);
    csvLines.push(`Session: ${session?.title || 'Unknown'}`);
    csvLines.push(`Date: ${timestamp}`);
    csvLines.push(`Student: ${student.name}`);
    csvLines.push(`Room Code: ${session?.room_code || 'N/A'}`);
    csvLines.push(``);
    csvLines.push(`PERFORMANCE SUMMARY:`);
    csvLines.push(`Average Attention Score: ${student.avgScore}%`);
    csvLines.push(`Attention Score Range: ${minScore}% - ${maxScore}%`);
    csvLines.push(`Total Attention Measurements: ${attentionUpdates.length}`);
    csvLines.push(``);
    csvLines.push(`COMPLIANCE SUMMARY:`);
    csvLines.push(`Total Warnings Issued: ${student.warnings}`);
    csvLines.push(`Total Time Away: ${Math.floor(student.timeAwayMs / 60000)}m ${Math.round((student.timeAwayMs % 60000) / 1000)}s`);
    csvLines.push(`Warning Events: ${warningEvents.length}`);
    csvLines.push(``);
    csvLines.push(`DETAILED EVENT LOG:`);
    csvLines.push(`Timestamp,Event Type,Details`);

    if (student.events && student.events.length > 0) {
      student.events.forEach(event => {
        const eventTime = event.timestamp?.toMillis 
          ? new Date(event.timestamp.toMillis()).toLocaleTimeString()
          : new Date(event.timestamp).toLocaleTimeString();
        const details = event.details ? `"${event.details}"` : '';
        csvLines.push(`${eventTime},${event.type},${details}`);
      });
    } else {
      csvLines.push(`No events recorded`);
    }

    const csvContent = csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `TrackSmart_Report_${student.name}_${session?.room_code || id}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportSummaryPDF = () => {
    try {
      const doc = new jsPDF();
      const title = 'TrackSmart Summary Report';
      doc.setFontSize(16);
      doc.text(title, 14, 20);

      const timestamp = session?.created_at 
        ? new Date(session.created_at.toMillis ? session.created_at.toMillis() : session.created_at).toLocaleString()
        : new Date().toLocaleString();

      doc.setFontSize(11);
      doc.text(`Session: ${session?.title || 'Unknown'}`, 14, 34);
      doc.text(`Date: ${timestamp}`, 14, 46);
      doc.text(`Room Code: ${session?.room_code || id}`, 14, 58);

      let y = 76;
      doc.setFontSize(11);
      doc.text('Student', 14, y);
      doc.text('Avg', 110, y);
      doc.text('Time Away', 140, y);
      doc.text('Warnings', 170, y);
      y += 8;

      reports.forEach((r) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(r.name, 14, y);
        doc.text(`${r.avgScore}%`, 110, y);
        const awayText = r.timeAwayMs > 60000 ? `${Math.floor(r.timeAwayMs / 60000)}m ${Math.round((r.timeAwayMs % 60000) / 1000)}s` : `${Math.round(r.timeAwayMs / 1000)}s`;
        doc.text(awayText, 140, y);
        doc.text(String(r.warnings), 170, y);
        y += 8;
      });

      doc.save(`TrackSmart_Summary_Report_${session?.room_code || id}.pdf`);
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      // fallback
      exportSummaryCSV();
    }
  };

  const exportIndividualPDF = (student: StudentReport) => {
    try {
      const doc = new jsPDF();
      const title = 'TrackSmart Individual Student Report';
      doc.setFontSize(16);
      doc.text(title, 14, 20);

      const timestamp = session?.created_at 
        ? new Date(session.created_at.toMillis ? session.created_at.toMillis() : session.created_at).toLocaleString()
        : new Date().toLocaleString();

      doc.setFontSize(11);
      doc.text(`Session: ${session?.title || 'Unknown'}`, 14, 34);
      doc.text(`Date: ${timestamp}`, 14, 46);
      doc.text(`Student: ${student.name}`, 14, 58);
      doc.text(`Room Code: ${session?.room_code || id}`, 14, 70);

      let y = 90;
      doc.setFontSize(12);
      doc.text('Performance Summary', 14, y);
      y += 10;
      doc.setFontSize(11);
      doc.text(`Average Attention Score: ${student.avgScore}%`, 14, y); y += 8;
      doc.text(`Total Warnings Issued: ${student.warnings}`, 14, y); y += 8;
      const awayText = student.timeAwayMs > 60000 ? `${Math.floor(student.timeAwayMs / 60000)}m ${Math.round((student.timeAwayMs % 60000) / 1000)}s` : `${Math.round(student.timeAwayMs / 1000)}s`;
      doc.text(`Total Time Away: ${awayText}`, 14, y); y += 12;

      doc.setFontSize(12);
      doc.text('Detailed Event Log', 14, y); y += 10;
      doc.setFontSize(10);

      if (student.events && student.events.length > 0) {
        student.events.forEach(event => {
          const evTime = event.timestamp?.toMillis ? new Date(event.timestamp.toMillis()).toLocaleString() : new Date(event.timestamp).toLocaleString();
          const line = `${evTime} — ${event.type}${event.details ? ` — ${event.details}` : ''}`;
          const split = doc.splitTextToSize(line, 180);
          if (y + (split.length * 6) > 280) { doc.addPage(); y = 20; }
          doc.text(split, 14, y);
          y += split.length * 6;
        });
      } else {
        doc.text('No events recorded.', 14, y);
      }

      const safeName = student.name.replace(/[^a-z0-9_-]/gi, '_');
      doc.save(`TrackSmart_Report_${safeName}_${session?.room_code || id}.pdf`);
    } catch (err) {
      console.error('Failed to generate individual PDF:', err);
      exportIndividualReport(student);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center">
          <Loader2 className="w-10 h-10 text-track-teal animate-spin mb-4" />
          <p className="text-slate-500 font-medium tracking-tight">Generating detailed report...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-12">
      <div className="max-w-4xl mx-auto">
        <button 
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-slate-500 hover:text-track-navy transition-colors mb-8 font-medium text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <div className="flex justify-between items-end mb-8">
          <div>
            <h1 className="text-3xl font-bold text-track-navy mb-2">Session Report</h1>
            <p className="text-slate-500">
              {session?.title || 'Loading Session...'} • 
              {session?.created_at && new Date(session.created_at.toMillis ? session.created_at.toMillis() : session.created_at).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={exportSummaryCSV}
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg font-medium hover:bg-slate-50 transition-colors shadow-sm text-sm"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button 
              onClick={exportSummaryPDF}
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg font-medium hover:bg-slate-50 transition-colors shadow-sm text-sm"
            >
              <FileText className="w-4 h-4" />
              Export PDF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-4">
            <div className="bg-track-teal/10 p-3 rounded-xl text-track-teal">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Total Students</p>
              <h3 className="text-2xl font-bold text-track-navy">{stats.totalStudents}</h3>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-4">
            <div className="bg-track-navy/5 p-3 rounded-xl text-track-navy">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Avg Attention</p>
              <h3 className="text-2xl font-bold text-track-navy">{stats.avgAttention}%</h3>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-4">
            <div className="bg-track-alert-amber/10 p-3 rounded-xl text-track-alert-amber">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">Total Warnings</p>
              <h3 className="text-2xl font-bold text-track-navy">{stats.totalWarnings}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left col-span-1 border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="p-4 pl-6">Student</th>
                <th className="p-4">Avg Score</th>
                <th className="p-4">Time Away</th>
                <th className="p-4">Warnings</th>
                <th className="p-4 text-center">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400 font-medium">No student data recorded for this session.</td>
                </tr>
              ) : reports.map(report => (
                <tr key={report.id} className="hover:bg-slate-50">
                  <td className="p-4 pl-6 font-medium text-slate-700">{report.name}</td>
                  <td className="p-4">
                    <span className={`font-bold px-2 py-1 rounded ${
                      report.avgScore > 80 ? 'bg-track-teal/10 text-track-teal' :
                      report.avgScore > 50 ? 'bg-track-alert-amber/10 text-track-alert-amber' :
                      'bg-track-alert-red/10 text-track-alert-red'
                    }`}>
                      {report.avgScore}%
                    </span>
                  </td>
                  <td className="p-4 text-slate-500">
                    {report.timeAwayMs > 60000 
                      ? `${Math.floor(report.timeAwayMs / 60000)}m ${Math.round((report.timeAwayMs % 60000) / 1000)}s`
                      : `${Math.round(report.timeAwayMs / 1000)}s`
                    }
                  </td>
                  <td className={`p-4 font-bold flex items-center gap-1.5 ${report.warnings > 0 ? 'text-track-alert-red' : 'text-slate-500'}`}>
                    {report.warnings > 0 && <AlertTriangle className="w-3.5 h-3.5" />} 
                    {report.warnings}
                  </td>
                  <td className="p-4 text-center space-x-2">
                    <button
                      onClick={() => exportIndividualReport(report)}
                      className="inline-flex items-center gap-1.5 text-track-teal hover:text-track-teal/80 transition-colors text-sm font-medium"
                      title={`Download CSV report for ${report.name}`}
                    >
                      <Download className="w-4 h-4" />
                      <span className="hidden sm:inline">CSV</span>
                    </button>
                    <button
                      onClick={() => exportIndividualPDF(report)}
                      className="inline-flex items-center gap-1.5 text-track-navy hover:text-track-navy/80 transition-colors text-sm font-medium"
                      title={`Download PDF report for ${report.name}`}
                    >
                      <FileText className="w-4 h-4" />
                      <span className="hidden sm:inline">PDF</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SessionReport;
