'use client';

/**
 * Live session countdown.
 *
 * Shows which policy actually ends the session — idle timeout or absolute
 * lifetime — and which one is binding. Being explicit here is the honest thing
 * to do: staff who are surprised by a 30-minute sign-out have no way to
 * anticipate it, and "your session expires in 4 minutes" with no explanation
 * reads as a fault.
 *
 * The countdown is display-only. It cannot extend a session, so there is no way
 * for a client to keep itself alive.
 */

import { useEffect, useState } from 'react';

type Props = {
  remainingMs: number;
  binding: 'idle' | 'absolute';
  idleMinutes: number;
};

const TICK_MS = 1000;

export function SessionTimer({ remainingMs, binding, idleMinutes }: Props) {
  const [remaining, setRemaining] = useState(remainingMs);

  useEffect(() => {
    setRemaining(remainingMs);
    const timer = setInterval(() => {
      setRemaining((current) => Math.max(0, current - TICK_MS));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [remainingMs]);

  const totalSeconds = Math.ceil(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const label =
    hours > 0
      ? `${hours}h ${String(minutes).padStart(2, '0')}m`
      : `${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;

  // Fraction of the governing budget still left, for the meter.
  const budget = binding === 'idle' ? idleMinutes * 60_000 : remainingMs;
  const percent = Math.max(0, Math.min(100, (remaining / budget) * 100));

  return (
    <div className="session-meter">
      <div
        className="session-meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label="Session time remaining"
      >
        <div className="session-meter-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="session-meter-foot">
        <span>
          {binding === 'idle'
            ? `Signs out after ${idleMinutes} minutes of inactivity`
            : 'Maximum session lifetime'}
        </span>
        <span className="session-meter-value">{label}</span>
      </div>
    </div>
  );
}
