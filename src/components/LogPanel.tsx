import React, { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';
import { LogEntry } from '../types';

interface LogPanelProps {
  logs: LogEntry[];
}

const LogPanel: React.FC<LogPanelProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle size={16} className="text-green-600" />;
      case 'error':
        return <AlertCircle size={16} className="text-red-600" />;
      case 'warning':
        return <AlertTriangle size={16} className="text-yellow-600" />;
      default:
        return <Info size={16} className="text-blue-600" />;
    }
  };

  const getLogColor = (type: string) => {
    switch (type) {
      case 'success':
        return 'text-green-800 bg-green-50';
      case 'error':
        return 'text-red-800 bg-red-50';
      case 'warning':
        return 'text-yellow-800 bg-yellow-50';
      default:
        return 'text-blue-800 bg-blue-50';
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('da-DK', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="h-80 bg-white border-t border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Activity Log</h2>
      </div>
      
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-2"
      >
        {logs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Info size={48} className="mx-auto mb-2 opacity-50" />
            <p>No activity yet</p>
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={`p-3 rounded-lg border-l-4 ${
                log.type === 'success'
                  ? 'border-green-500 bg-green-50'
                  : log.type === 'error'
                  ? 'border-red-500 bg-red-50'
                  : log.type === 'warning'
                  ? 'border-yellow-500 bg-yellow-50'
                  : 'border-blue-500 bg-blue-50'
              }`}
            >
              <div className="flex items-center gap-2">
                {getLogIcon(log.type)}
                <span className="text-sm text-gray-600">
                  {formatTime(log.timestamp)}
                </span>
                <span className="text-sm text-gray-900 flex-1">
                  {log.message}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LogPanel;