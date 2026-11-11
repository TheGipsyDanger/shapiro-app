import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { addDays, isSameDay, startOfDay, subDays } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Images,
  Pencil,
  Plus,
} from 'lucide-react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getStudyBlocksForRange } from '@/db/database';
import { useSessionStore } from '@/stores/useSessionStore';
import type { StudyBlockWithSubject } from '@/types/domain';
import {
  DP_PER_MINUTE,
  formatDayHeading,
  formatDurationCompact,
  formatTimeRange,
  formatTimeShort,
  getMinutesSinceTimelineStart,
  getTimelineDayBounds,
  TIMELINE_END_HOUR,
  TIMELINE_HEIGHT,
  TIMELINE_START_HOUR,
  TIMELINE_TOTAL_MINUTES,
} from '@/utils/schedule';

const HOURS = Array.from(
  { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 },
  (_, idx) => TIMELINE_START_HOUR + idx
);

function NowIndicator({ topDp, nowTimeLabel }: { topDp: number; nowTimeLabel: string }) {
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.85);

  useEffect(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.65, { duration: 1100, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 1100, easing: Easing.in(Easing.ease) })
      ),
      -1,
      false
    );
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(0.2, { duration: 1100 }),
        withTiming(0.85, { duration: 1100 })
      ),
      -1,
      false
    );
  }, [pulseOpacity, pulseScale]);

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  return (
    <View
      pointerEvents="none"
      style={{ top: topDp }}
      className="absolute left-0 right-0 z-20 flex-row items-center"
    >
      <View className="w-16 pr-2 items-end">
        <View className="px-1.5 py-0.5 rounded bg-status-success/20 border border-status-success/60">
          <Text className="text-[10px] font-mono font-bold text-status-success">
            {nowTimeLabel}
          </Text>
        </View>
      </View>

      <View className="relative items-center justify-center mr-1">
        <Animated.View
          style={haloStyle}
          className="absolute w-3.5 h-3.5 rounded-full bg-status-success"
        />
        <View className="w-2.5 h-2.5 rounded-full bg-status-success" />
      </View>

      <View className="flex-1 h-[1.5px] bg-status-success" />
    </View>
  );
}

export default function ScheduleTimelineScreen() {
  const router = useRouter();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const hasAutoScrolled = useRef(false);

  const scheduleVersion = useSessionStore((s) => s.scheduleVersion);
  const activeBlock = useSessionStore((s) => s.activeBlock);
  const refreshActiveSession = useSessionStore((s) => s.refreshActiveSession);

  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [blocks, setBlocks] = useState<StudyBlockWithSubject[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const isToday = useMemo(() => isSameDay(selectedDate, new Date(nowMs)), [selectedDate, nowMs]);

  const loadDayBlocks = useCallback(() => {
    const { timelineStartMs, timelineEndMs } = getTimelineDayBounds(selectedDate);
    const items = getStudyBlocksForRange(timelineStartMs, timelineEndMs);
    setBlocks(items);
  }, [selectedDate]);

  useFocusEffect(
    useCallback(() => {
      setNowMs(Date.now());
      loadDayBlocks();
      refreshActiveSession();
    }, [loadDayBlocks, refreshActiveSession])
  );

  useEffect(() => {
    loadDayBlocks();
  }, [loadDayBlocks, scheduleVersion]);

  // Update NOW marker every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
      refreshActiveSession();
    }, 60_000);
    return () => clearInterval(interval);
  }, [refreshActiveSession]);

  // Auto-scroll on mount to Math.max(0, (nowMinutes - 30) * 1.2)
  useEffect(() => {
    if (hasAutoScrolled.current) return;
    hasAutoScrolled.current = true;
    const nowMinutes = getMinutesSinceTimelineStart(Date.now(), new Date());
    const clampedMinutes = Math.min(TIMELINE_TOTAL_MINUTES, Math.max(0, nowMinutes));
    const offsetY = Math.max(0, (clampedMinutes - 30) * DP_PER_MINUTE);
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: offsetY, animated: false });
    }, 80);
    return () => clearTimeout(timer);
  }, []);

  const nowMinutes = getMinutesSinceTimelineStart(nowMs, selectedDate);
  const showNowMarker = isToday && nowMinutes >= 0 && nowMinutes <= TIMELINE_TOTAL_MINUTES;
  const nowTopDp = Math.max(0, Math.min(TIMELINE_HEIGHT, nowMinutes * DP_PER_MINUTE));

  const dayStats = useMemo(() => {
    const totalMs = blocks.reduce((acc, b) => acc + (b.endTime - b.startTime), 0);
    const totalPhotos = blocks.reduce((acc, b) => acc + b.photoCount, 0);
    return {
      count: blocks.length,
      durationLabel: formatDurationCompact(totalMs),
      totalPhotos,
    };
  }, [blocks]);

  const openNewBlockAtHour = (hour?: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const baseDay = startOfDay(selectedDate).getTime();
    let defaultStartMs: number;
    if (typeof hour === 'number') {
      defaultStartMs = baseDay + hour * 60 * 60 * 1000;
    } else if (isToday) {
      // Round up to next 15-minute increment
      const step = 15 * 60_000;
      defaultStartMs = Math.ceil(Date.now() / step) * step;
    } else {
      defaultStartMs = baseDay + 9 * 60 * 60 * 1000;
    }

    router.push({
      pathname: '/modal/add-grind',
      params: {
        initialStartTime: String(defaultStartMs),
      },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas" edges={['top']}>
      {/* Top Bar */}
      <View className="px-5 pt-2 pb-3 border-b border-surface-stroke/60">
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-2">
            <View className="w-2.5 h-2.5 rounded-full bg-subject-premed" />
            <Text className="text-base font-mono font-bold tracking-[0.2em] text-brand-white">
              SHAPIRO
            </Text>
          </View>

          <View className="flex-row items-center gap-1.5">
            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setSelectedDate((d) => subDays(d, 1));
              }}
              className="w-8 h-8 rounded-lg bg-surface-subtle border border-surface-stroke items-center justify-center active:opacity-75"
            >
              <ChevronLeft size={16} color="#FAFAFA" />
            </Pressable>

            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setSelectedDate(startOfDay(new Date()));
              }}
              className="px-3 h-8 rounded-lg bg-surface-subtle border border-surface-stroke items-center justify-center active:opacity-75"
            >
              <Text className="text-xs font-mono font-semibold text-brand-white">
                {isToday ? 'TODAY' : 'GO TODAY'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setSelectedDate((d) => addDays(d, 1));
              }}
              className="w-8 h-8 rounded-lg bg-surface-subtle border border-surface-stroke items-center justify-center active:opacity-75"
            >
              <ChevronRight size={16} color="#FAFAFA" />
            </Pressable>
          </View>
        </View>

        <View className="flex-row items-end justify-between">
          <View>
            <Text className="text-xl font-bold text-brand-white tracking-tight">
              {formatDayHeading(selectedDate)}
            </Text>
            <Text className="text-xs font-mono text-brand-muted mt-0.5">
              {dayStats.count} {dayStats.count === 1 ? 'block' : 'blocks'} ·{' '}
              {dayStats.durationLabel} scheduled · {dayStats.totalPhotos} vault shots
            </Text>
          </View>
        </View>
      </View>

      {/* Active Session Live Banner */}
      {activeBlock ? (
        <View className="mx-4 mt-3 p-3 rounded-2xl bg-surface-subtle border border-subject-premed/50 flex-row items-center justify-between">
          <Pressable
            onPress={() => router.push('/(tabs)/camera')}
            className="flex-1 flex-row items-center gap-3"
          >
            <View
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: activeBlock.subjectColor }}
            />
            <View className="flex-1">
              <Text className="text-[11px] font-mono uppercase tracking-wider text-subject-premed">
                LIVE GRIND · {activeBlock.subjectName}
              </Text>
              <Text className="text-sm font-semibold text-brand-white" numberOfLines={1}>
                {activeBlock.title}
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => router.push('/(tabs)/camera')}
            className="px-3 py-2 rounded-xl bg-subject-premed flex-row items-center gap-1.5 active:opacity-80"
          >
            <Camera size={14} color="#09090B" strokeWidth={2.4} />
            <Text className="text-xs font-bold text-surface-canvas">Cam</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Timeline Grid 06:00 -> 24:00 (1080 min * 1.2 dp = 1296 dp) */}
      <ScrollView
        ref={scrollRef}
        className="flex-1 mt-2"
        contentContainerStyle={{ paddingBottom: 110, paddingTop: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ height: TIMELINE_HEIGHT + 24 }} className="relative mx-2">
          {/* Hour Rows */}
          {HOURS.map((hour) => {
            const topDp = (hour - TIMELINE_START_HOUR) * 60 * DP_PER_MINUTE;
            const label = `${String(hour).padStart(2, '0')}:00`;
            const isLast = hour === TIMELINE_END_HOUR;

            return (
              <View
                key={hour}
                style={{ top: topDp, height: isLast ? 24 : 60 * DP_PER_MINUTE }}
                className="absolute left-0 right-0 flex-row"
              >
                <View className="w-16 pr-3 -mt-2 items-end">
                  <Text className="text-[11px] font-mono text-brand-dim">{label}</Text>
                </View>

                <Pressable
                  disabled={isLast}
                  onPress={() => openNewBlockAtHour(hour)}
                  className="flex-1 border-t border-surface-stroke/45 active:bg-surface-subtle/40"
                >
                  {!isLast ? (
                    <View
                      style={{ top: 30 * DP_PER_MINUTE }}
                      className="absolute left-0 right-0 border-t border-dashed border-surface-stroke/20"
                    />
                  ) : null}
                </Pressable>
              </View>
            );
          })}

          {/* Study Blocks */}
          {blocks.map((block) => {
            const { timelineStartMs, timelineEndMs } = getTimelineDayBounds(selectedDate);
            const clampedStart = Math.max(block.startTime, timelineStartMs);
            const clampedEnd = Math.min(block.endTime, timelineEndMs);
            if (clampedEnd <= clampedStart) return null;

            const startMins = (clampedStart - timelineStartMs) / 60_000;
            const durationMins = (clampedEnd - clampedStart) / 60_000;
            const topDp = startMins * DP_PER_MINUTE;
            const heightDp = Math.max(38, durationMins * DP_PER_MINUTE);
            const isCompact = heightDp < 62;
            const isLive = nowMs >= block.startTime && nowMs < block.endTime;

            return (
              <Pressable
                key={block.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  router.push({
                    pathname: '/vault/[blockId]',
                    params: { blockId: block.id },
                  });
                }}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  router.push({
                    pathname: '/modal/add-grind',
                    params: { blockId: block.id },
                  });
                }}
                style={{
                  top: topDp + 1,
                  height: heightDp - 2,
                  left: 68,
                  right: 8,
                  borderLeftColor: block.subjectColor,
                  borderLeftWidth: 4,
                }}
                className={`absolute z-10 rounded-xl px-3 py-2 border justify-between active:opacity-85 ${
                  isLive
                    ? 'bg-surface-elevated border-subject-premed/60'
                    : 'bg-surface-subtle border-surface-stroke'
                }`}
              >
                <View className="flex-row items-center justify-between gap-2">
                  <View className="flex-row items-center gap-2 flex-1">
                    <View
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: block.subjectColor }}
                    />
                    <Text
                      className="text-xs font-mono font-semibold uppercase tracking-wider"
                      style={{ color: block.subjectColor }}
                      numberOfLines={1}
                    >
                      {block.subjectName}
                    </Text>
                  </View>

                  <View className="flex-row items-center gap-2">
                    <View className="flex-row items-center gap-1 px-1.5 py-0.5 rounded bg-surface-canvas/70 border border-surface-stroke/60">
                      <Images size={11} color="#A1A1AA" />
                      <Text className="text-[10px] font-mono text-brand-muted">
                        {block.photoCount}
                      </Text>
                    </View>

                    <Pressable
                      hitSlop={10}
                      onPress={(e) => {
                        e.stopPropagation();
                        Haptics.selectionAsync().catch(() => {});
                        router.push({
                          pathname: '/modal/add-grind',
                          params: { blockId: block.id },
                        });
                      }}
                      className="p-1 rounded bg-surface-canvas/50"
                    >
                      <Pencil size={11} color="#A1A1AA" />
                    </Pressable>
                  </View>
                </View>

                {!isCompact ? (
                  <View>
                    <Text
                      className="text-sm font-bold text-brand-white leading-snug"
                      numberOfLines={1}
                    >
                      {block.title}
                    </Text>
                    <Text className="text-[11px] font-mono text-brand-muted mt-0.5">
                      {formatTimeRange(block.startTime, block.endTime)} ·{' '}
                      {formatDurationCompact(block.endTime - block.startTime)}
                    </Text>
                  </View>
                ) : (
                  <Text className="text-xs font-semibold text-brand-white" numberOfLines={1}>
                    {block.title} · {formatTimeShort(block.startTime)}
                  </Text>
                )}
              </Pressable>
            );
          })}

          {/* Empty State Helper Card */}
          {blocks.length === 0 ? (
            <View
              style={{ top: Math.max(48, isToday ? nowTopDp + 24 : 180), left: 76, right: 16 }}
              className="absolute z-10 p-4 rounded-2xl bg-surface-subtle/95 border border-dashed border-surface-stroke"
            >
              <Text className="text-sm font-semibold text-brand-white mb-1">
                Clean slate for {isToday ? 'today' : 'this day'}
              </Text>
              <Text className="text-xs text-brand-muted leading-5">
                Tap any hour slot or press <Text className="text-subject-premed font-semibold">+ Add Grind</Text> below to lock in a zero-overlap study block.
              </Text>
            </View>
          ) : null}

          {/* Breathing NOW Marker */}
          {showNowMarker ? (
            <NowIndicator topDp={nowTopDp} nowTimeLabel={formatTimeShort(nowMs)} />
          ) : null}
        </View>
      </ScrollView>

      {/* Fixed Bottom-Center Neon Glow FAB */}
      <View
        pointerEvents="box-none"
        className="absolute bottom-5 left-0 right-0 items-center justify-center"
      >
        <Pressable
          onPress={() => openNewBlockAtHour()}
          className="px-6 py-3.5 rounded-full bg-subject-premed flex-row items-center gap-2 active:scale-95"
          style={{
            shadowColor: '#10B981',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.65,
            shadowRadius: 18,
            elevation: 10,
          }}
        >
          <Plus size={18} color="#09090B" strokeWidth={2.8} />
          <Text className="text-sm font-bold text-surface-canvas tracking-tight">
            Add Grind
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
