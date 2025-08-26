import React from 'react';
import { Download, Database, FileArchive, CheckCircle, Loader2 } from 'lucide-react';

interface SyncSplashScreenProps {
  isVisible: boolean;
  progress: {
    step: string;
    currentSite: string;
    sitesProcessed: number;
    totalSites: number;
    entriesProcessed: number;
    totalEntries: number;
    isComplete: boolean;
  };
}

const SyncSplashScreen: React.FC<SyncSplashScreenProps> = ({ isVisible, progress }) => {
  if (!isVisible) return null;

  const steps = [
    { id: 'loading-sites', label: 'Loading sites from database', icon: Database },
    { id: 'loading-entries', label: 'Loading entries from database', icon: Database },
    { id: 'creating-zip', label: 'Creating ZIP structure', icon: FileArchive },
    { id: 'generating-zip', label: 'Generating ZIP file', icon: Download },
    { id: 'complete', label: 'Download ready', icon: CheckCircle }
  ];

  const getCurrentStepIndex = () => {
    return steps.findIndex(step => step.id === progress.step);
  };

  const currentStepIndex = getCurrentStepIndex();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 p-6">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Download className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Preparing Sync Download
          </h2>
          <p className="text-gray-600 text-sm">
            Please wait while we prepare your knowledge sync ZIP file
          </p>
        </div>

        {/* Progress Steps */}
        <div className="space-y-3 mb-6">
          {steps.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = index === currentStepIndex;
            const isCompleted = index < currentStepIndex;
            const isPending = index > currentStepIndex;

            return (
              <div
                key={step.id}
                className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 ${
                  isActive
                    ? 'bg-blue-50 border border-blue-200'
                    : isCompleted
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-gray-50 border border-gray-200'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : isCompleted
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-300 text-gray-600'
                  }`}
                >
                  {isActive ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <StepIcon className="w-4 h-4" />
                  )}
                </div>
                <div className="flex-1">
                  <p
                    className={`text-sm font-medium transition-all duration-300 ${
                      isActive
                        ? 'text-blue-900'
                        : isCompleted
                        ? 'text-green-900'
                        : 'text-gray-600'
                    }`}
                  >
                    {step.label}
                  </p>
                  {isActive && progress.currentSite && (
                    <p className="text-xs text-blue-700 mt-1">
                      Processing: {progress.currentSite}
                    </p>
                  )}
                </div>
                {isCompleted && (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                )}
              </div>
            );
          })}
        </div>

        {/* Progress Details */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Sites processed:</span>
            <span className="font-medium text-gray-900">
              {progress.sitesProcessed} / {progress.totalSites}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Total entries:</span>
            <span className="font-medium text-gray-900">
              {progress.totalEntries.toLocaleString()}
            </span>
          </div>
          {progress.entriesProcessed > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Entries processed:</span>
              <span className="font-medium text-gray-900">
                {progress.entriesProcessed.toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>Overall Progress</span>
            <span>
              {Math.round(
                ((currentStepIndex + (progress.sitesProcessed / Math.max(progress.totalSites, 1))) / steps.length) * 100
              )}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${Math.min(
                  ((currentStepIndex + (progress.sitesProcessed / Math.max(progress.totalSites, 1))) / steps.length) * 100,
                  100
                )}%`
              }}
            />
          </div>
        </div>

        {/* Warning */}
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-xs text-yellow-800">
            <strong>Please wait:</strong> Do not close this window or navigate away while the sync is being prepared.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SyncSplashScreen;