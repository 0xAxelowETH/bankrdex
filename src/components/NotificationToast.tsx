import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { X } from 'lucide-react';

export const NotificationToast: React.FC = () => {
  const { alerts } = useApp();
  const [latestAlert, setLatestAlert] = useState<typeof alerts[0] | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (alerts.length > 0) {
      const top = alerts[0];
      // Only show if generated within the last 4 seconds
      if (Date.now() - top.timestamp < 4500) {
        setLatestAlert(top);
        setVisible(true);
        const timer = setTimeout(() => {
          setVisible(false);
        }, 4000);
        return () => clearTimeout(timer);
      }
    }
  }, [alerts]);

  if (!visible || !latestAlert) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-amber-500/30 bg-panel/95 p-3.5 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-5">
      <div className="flex items-start gap-3">
        <span className="text-xl">
          {latestAlert.type === 'whale' ? '🐋' : '⚡'}
        </span>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-fg">{latestAlert.title}</h4>
            <button
              onClick={() => setVisible(false)}
              className="text-subtle hover:text-fg p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <p className="mt-1 text-[0.75rem] text-fg-soft leading-relaxed">
            {latestAlert.message}
          </p>
        </div>
      </div>
    </div>
  );
};
