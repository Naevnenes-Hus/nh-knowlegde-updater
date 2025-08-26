import React from 'react';
import { ExternalLink, Calendar, FileText, Eye, Trash2 } from 'lucide-react';
import { Entry } from '../types';

interface PreviewPanelProps {
  entry: Entry | null;
  onMarkAsSeen: (entry: Entry) => void;
  onDeleteEntry: (entry: Entry) => void;
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({ entry, onMarkAsSeen, onDeleteEntry }) => {
  if (!entry) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-500">
          <FileText size={64} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg">Select an entry to preview</p>
        </div>
      </div>
    );
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('da-DK', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getMetadataValue = (key: string) => {
    if (!entry.metadata) return '';
    const value = entry.metadata[key];
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    return value || '';
  };

  return (
    <div className="flex-1 bg-white overflow-y-auto">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                {entry.title}
              </h1>
              {!entry.seen && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                  New
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
              <div className="flex items-center gap-1">
                <Calendar size={16} />
                {formatDate(entry.publishedDate)}
              </div>
              <span className="text-gray-300">•</span>
              <span className="capitalize">{entry.type}</span>
              {getMetadataValue('jnr') && (
                <>
                  <span className="text-gray-300">•</span>
                  <span>J.nr. {getMetadataValue('jnr')}</span>
                </>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              {!entry.seen && (
                <button
                  onClick={() => onMarkAsSeen(entry)}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Eye size={16} />
                  Mark as Seen
                </button>
              )}
              
              {entry.siteUrl && (
                <a
                  href={`${entry.siteUrl}/nyhed/${entry.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <ExternalLink size={16} />
                  View Original
                </a>
              )}
              
              <button
                onClick={() => {
                  if (window.confirm(`Are you sure you want to delete "${entry.title}"?`)) {
                    onDeleteEntry(entry);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <Trash2 size={16} />
                Delete Entry
              </button>
            </div>
          </div>
        </div>

        {/* Metadata */}
        {entry.metadata && Object.keys(entry.metadata).length > 0 && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Metadata</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {getMetadataValue('authority') && (
                <div>
                  <span className="font-medium text-gray-600">Authority:</span>
                  <span className="ml-2 text-gray-900">{getMetadataValue('authority')}</span>
                </div>
              )}
              
              {getMetadataValue('categories') && (
                <div>
                  <span className="font-medium text-gray-600">Categories:</span>
                  <span className="ml-2 text-gray-900">{getMetadataValue('categories')}</span>
                </div>
              )}
              
              {getMetadataValue('is_board_ruling') && (
                <div>
                  <span className="font-medium text-gray-600">Board Ruling:</span>
                  <span className="ml-2 text-gray-900">{getMetadataValue('is_board_ruling')}</span>
                </div>
              )}
              
              {getMetadataValue('is_brought_to_court') && (
                <div>
                  <span className="font-medium text-gray-600">Brought to Court:</span>
                  <span className="ml-2 text-gray-900">{getMetadataValue('is_brought_to_court')}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Abstract */}
        {entry.abstract && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Abstract</h3>
            <div className="prose prose-gray max-w-none">
              <p className="text-gray-700 leading-relaxed">{entry.abstract}</p>
            </div>
          </div>
        )}

        {/* Body */}
        {entry.body && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Content</h3>
            <div className="prose prose-gray max-w-none">
              <div className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                {entry.body}
              </div>
            </div>
          </div>
        )}

        {/* Entry ID for reference */}
        <div className="mt-8 pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500">
            Entry ID: {entry.id}
          </p>
        </div>
      </div>
    </div>
  );
};

export default PreviewPanel;