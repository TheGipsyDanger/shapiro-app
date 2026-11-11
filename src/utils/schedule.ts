import { addDays, format, isSameDay, startOfDay } from 'date-fns';

export const TIMELINE_START_HOUR = 6; // 06:00
export const TIMELINE_END_HOUR = 24; // 24:00
export const TIMELINE_TOTAL_MINUTES = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60; // 1080 min
export const DP_PER_MINUTE = 1.2;
export const TIMELINE_HEIGHT = TIMELINE_TOTAL_MINUTES * DP_PER_MINUTE; // 1296 dp

export interface BlockInterval {
  id?: string;
  startTime: number;
  endTime: number;
  title?: string;
}

export function detectScheduleConflict(
  candidate: { startTime: number; endTime: number; id?: string },
  existingBlocks: BlockInterval[]
): BlockInterval | null {
  if (candidate.startTime >= candidate.endTime) {
    throw new Error('Invalid time window: startTime must precede endTime');
  }

  for (const block of existingBlocks) {
    if (candidate.id && block.id === candidate.id) continue;

    // Clash condition: max(S1, S2) < min(E1, E2)
    if (candidate.startTime < block.endTime && candidate.endTime > block.startTime) {
      return block;
    }
  }

  return null;
}

export function findNextAvailableSlot(
  fromTime: number,
  durationMs: number,
  futureBlocks: BlockInterval[]
): { startTime: number; endTime: number } {
  const sorted = [...futureBlocks]
    .filter((b) => b.endTime > fromTime)
    .sort((a, b) => a.startTime - b.startTime);

  let candidateStart = fromTime;

  for (const block of sorted) {
    if (candidateStart + durationMs <= block.startTime) {
      return {
        startTime: candidateStart,
        endTime: candidateStart + durationMs,
      };
    }
    candidateStart = Math.max(candidateStart, block.endTime);
  }

  return {
    startTime: candidateStart,
    endTime: candidateStart + durationMs,
  };
}

export function getActiveStudyBlock<T extends BlockInterval & { subjectId: string }>(
  currentTime: number,
  blocks: T[]
): T | null {
  return blocks.find((b) => currentTime >= b.startTime && currentTime < b.endTime) ?? null;
}

export function getTimelineDayBounds(date: Date): {
  dayStartMs: number;
  dayEndMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
} {
  const dayStart = startOfDay(date);
  const nextDayStart = startOfDay(addDays(date, 1));
  const timelineStartMs = dayStart.getTime() + TIMELINE_START_HOUR * 60 * 60 * 1000;
  const timelineEndMs = dayStart.getTime() + TIMELINE_END_HOUR * 60 * 60 * 1000;
  return {
    dayStartMs: dayStart.getTime(),
    dayEndMs: nextDayStart.getTime(),
    timelineStartMs,
    timelineEndMs,
  };
}

export function getMinutesSinceTimelineStart(epochMs: number, dayDate: Date): number {
  const { timelineStartMs } = getTimelineDayBounds(dayDate);
  return (epochMs - timelineStartMs) / 60_000;
}

export function formatTimeShort(epochMs: number): string {
  return format(new Date(epochMs), 'HH:mm');
}

export function formatTimeRange(startTime: number, endTime: number): string {
  return `${formatTimeShort(startTime)} – ${formatTimeShort(endTime)}`;
}

export function formatDayHeading(date: Date): string {
  const now = new Date();
  if (isSameDay(date, now)) {
    return `Today · ${format(date, 'EEE, MMM d')}`;
  }
  return format(date, 'EEEE · MMM d');
}

export function formatDurationCompact(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

export function formatCountdownMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

