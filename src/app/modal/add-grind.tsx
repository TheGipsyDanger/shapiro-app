import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { addDays, format, startOfDay, subDays } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Minus,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createStudyBlock,
  deleteStudyBlock,
  getStudyBlockById,
  getStudyBlocksForRange,
  getSubjects,
  ScheduleConflictError,
  updateStudyBlock,
} from '@/db/database';
import { useSessionStore } from '@/stores/useSessionStore';
import type { StudyBlockWithSubject, Subject } from '@/types/domain';
import {
  BlockInterval,
  detectScheduleConflict,
  findNextAvailableSlot,
  formatDurationCompact,
  formatTimeRange,
  formatTimeShort,
} from '@/utils/schedule';

const DURATION_PRESETS_MIN = [30, 60, 90, 120, 180] as const;
const STEP_MS = 15 * 60_000;

export default function AddGrindModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    blockId?: string;
    initialStartTime?: string;
  }>();

  const blockId = typeof params.blockId === 'string' ? params.blockId : undefined;
  const isEditing = Boolean(blockId);

  const refreshActiveSession = useSessionStore((s) => s.refreshActiveSession);
  const bumpScheduleVersion = useSessionStore((s) => s.bumpScheduleVersion);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [existingBlocks, setExistingBlocks] = useState<StudyBlockWithSubject[]>([]);

  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [startTime, setStartTime] = useState<number>(() => {
    const parsed = params.initialStartTime ? Number(params.initialStartTime) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return Math.ceil(Date.now() / STEP_MS) * STEP_MS;
  });
  const [endTime, setEndTime] = useState<number>(() => {
    const parsed = params.initialStartTime ? Number(params.initialStartTime) : NaN;
    const base = Number.isFinite(parsed) && parsed > 0 ? parsed : Math.ceil(Date.now() / STEP_MS) * STEP_MS;
    return base + 60 * 60_000;
  });

  const [conflict, setConflict] = useState<BlockInterval | null>(null);
  const [nextSlot, setNextSlot] = useState<{ startTime: number; endTime: number } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const lastHapticConflictRef = useRef<string | null>(null);

  // Load subjects, target block (if editing), and surrounding blocks for clash checks
  useEffect(() => {
    const allSubjects = getSubjects();
    setSubjects(allSubjects);

    if (blockId) {
      const target = getStudyBlockById(blockId);
      if (target) {
        setTitle(target.title);
        setSubjectId(target.subjectId);
        setStartTime(target.startTime);
        setEndTime(target.endTime);
      }
    } else if (allSubjects.length > 0) {
      setSubjectId((prev) => prev || allSubjects[0].id);
    }
  }, [blockId]);

  useEffect(() => {
    const dayStart = startOfDay(subDays(new Date(startTime), 1)).getTime();
    const dayEnd = startOfDay(addDays(new Date(startTime), 3)).getTime();
    setExistingBlocks(getStudyBlocksForRange(dayStart, dayEnd));
  }, [startTime]);

  // Strict Rule 1: Real-time interval conflict detection
  useEffect(() => {
    if (startTime >= endTime) {
      setConflict(null);
      setNextSlot(null);
      setValidationError('End time must be after start time.');
      return;
    }

    setValidationError(null);
    const detected = detectScheduleConflict(
      { id: blockId, startTime, endTime },
      existingBlocks
    );
    setConflict(detected);

    if (detected) {
      const durationMs = endTime - startTime;
      const futurePool = existingBlocks.filter((b) => b.id !== blockId);
      const recommended = findNextAvailableSlot(startTime, durationMs, futurePool);
      setNextSlot(recommended);

      const sig = `${detected.id}_${startTime}_${endTime}`;
      if (lastHapticConflictRef.current !== sig) {
        lastHapticConflictRef.current = sig;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } else {
      lastHapticConflictRef.current = null;
      setNextSlot(null);
    }
  }, [blockId, endTime, existingBlocks, startTime]);

  const selectedSubject = useMemo(
    () => subjects.find((s) => s.id === subjectId) ?? subjects[0] ?? null,
    [subjectId, subjects]
  );

  const durationMs = Math.max(0, endTime - startTime);
  const durationMinutes = Math.round(durationMs / 60_000);

  const adjustStart = (deltaMs: number) => {
    Haptics.selectionAsync().catch(() => {});
    const currentDuration = Math.max(15 * 60_000, endTime - startTime);
    const nextStart = startTime + deltaMs;
    setStartTime(nextStart);
    setEndTime(nextStart + currentDuration);
  };

  const adjustEnd = (deltaMs: number) => {
    Haptics.selectionAsync().catch(() => {});
    const candidateEnd = endTime + deltaMs;
    if (candidateEnd <= startTime + 15 * 60_000 - 1) {
      setEndTime(startTime + 15 * 60_000);
      return;
    }
    setEndTime(candidateEnd);
  };

  const applyDurationPreset = (minutes: number) => {
    Haptics.selectionAsync().catch(() => {});
    setEndTime(startTime + minutes * 60_000);
  };

  const jumpToNow = () => {
    Haptics.selectionAsync().catch(() => {});
    const dur = Math.max(30 * 60_000, endTime - startTime);
    const now = Date.now();
    setStartTime(now);
    setEndTime(now + dur);
  };

  const applyNextSlot = () => {
    if (!nextSlot) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setStartTime(nextSlot.startTime);
    setEndTime(nextSlot.endTime);
  };

  const canSubmit =
    Boolean(selectedSubject) &&
    title.trim().length > 0 &&
    startTime < endTime &&
    conflict === null &&
    validationError === null;

  const handleSave = async () => {
    if (!canSubmit || !selectedSubject) return;

    try {
      if (isEditing && blockId) {
        updateStudyBlock(blockId, {
          subjectId: selectedSubject.id,
          title: title.trim(),
          startTime,
          endTime,
        });
      } else {
        createStudyBlock({
          subjectId: selectedSubject.id,
          title: title.trim(),
          startTime,
          endTime,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await refreshActiveSession();
      bumpScheduleVersion();
      router.back();
    } catch (err) {
      if (err instanceof ScheduleConflictError) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setConflict({
          id: err.conflictingBlock.id,
          title: err.conflictingBlock.title,
          startTime: err.conflictingBlock.startTime,
          endTime: err.conflictingBlock.endTime,
        });
      } else {
        Alert.alert('Unable to save', err instanceof Error ? err.message : 'Unknown error');
      }
    }
  };

  const handleDelete = () => {
    if (!blockId) return;
    Alert.alert(
      'Delete Study Block?',
      'This will remove the block and permanently delete any Study Vault photos captured inside it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            deleteStudyBlock(blockId);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            await refreshActiveSession();
            bumpScheduleVersion();
            router.back();
          },
        },
      ]
    );
  };

  const hasClash = conflict !== null || validationError !== null;

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View className="px-5 py-4 border-b border-surface-stroke/60 flex-row items-center justify-between">
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            className="w-9 h-9 rounded-full bg-surface-subtle border border-surface-stroke items-center justify-center active:opacity-75"
          >
            <X size={18} color="#FAFAFA" />
          </Pressable>

          <Text className="text-base font-bold text-brand-white tracking-tight">
            {isEditing ? 'Edit Grind Block' : 'New Grind Block'}
          </Text>

          {isEditing ? (
            <Pressable
              onPress={handleDelete}
              hitSlop={10}
              className="w-9 h-9 rounded-full bg-status-danger/15 border border-status-danger/40 items-center justify-center active:opacity-75"
            >
              <Trash2 size={16} color="#EF4444" />
            </Pressable>
          ) : (
            <View className="w-9" />
          )}
        </View>

        <ScrollView
          className="flex-1 px-5"
          contentContainerStyle={{ paddingVertical: 20, paddingBottom: 40, gap: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Focus Title */}
          <View>
            <Text className="text-xs font-mono uppercase tracking-wider text-brand-muted mb-2">
              Session Goal
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Integration by Parts Problem Set"
              placeholderTextColor="#71717A"
              autoFocus={!isEditing}
              returnKeyType="done"
              className="px-4 py-3.5 rounded-2xl bg-surface-subtle border border-surface-stroke text-brand-white text-base font-medium"
            />
          </View>

          {/* Subject Picker */}
          <View>
            <Text className="text-xs font-mono uppercase tracking-wider text-brand-muted mb-2.5">
              Subject
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {subjects.map((subj) => {
                const selected = subj.id === selectedSubject?.id;
                return (
                  <Pressable
                    key={subj.id}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      setSubjectId(subj.id);
                    }}
                    style={{
                      borderColor: selected ? subj.color : '#3F3F46',
                      backgroundColor: selected ? `${subj.color}22` : '#18181B',
                    }}
                    className="px-3.5 py-2.5 rounded-xl border flex-row items-center gap-2 active:opacity-80"
                  >
                    <View
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: subj.color }}
                    />
                    <Text className="text-sm font-semibold text-brand-white">{subj.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Time Window Card (Turns #EF4444 on clash!) */}
          <View
            style={{
              borderColor: hasClash ? '#EF4444' : '#3F3F46',
            }}
            className="rounded-2xl bg-surface-subtle border-2 p-4 gap-4"
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Clock size={15} color={hasClash ? '#EF4444' : '#A1A1AA'} />
                <Text className="text-xs font-mono uppercase tracking-wider text-brand-muted">
                  Time Window · {format(new Date(startTime), 'EEE, MMM d')}
                </Text>
              </View>

              <Pressable
                onPress={jumpToNow}
                className="px-2.5 py-1 rounded-lg bg-surface-elevated border border-surface-stroke active:opacity-75"
              >
                <Text className="text-[11px] font-mono font-semibold text-subject-premed">
                  SET NOW
                </Text>
              </Pressable>
            </View>

            {/* Start / End Steppers */}
            <View className="flex-row gap-3">
              {/* Start Time */}
              <View className="flex-1 rounded-xl bg-surface-canvas border border-surface-stroke p-3">
                <Text className="text-[10px] font-mono uppercase text-brand-dim mb-1">
                  Start
                </Text>
                <Text className="text-2xl font-mono font-bold text-brand-white mb-2.5">
                  {formatTimeShort(startTime)}
                </Text>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => adjustStart(-STEP_MS)}
                    className="flex-1 py-2 rounded-lg bg-surface-elevated items-center justify-center active:opacity-70"
                  >
                    <Minus size={14} color="#FAFAFA" />
                  </Pressable>
                  <Pressable
                    onPress={() => adjustStart(STEP_MS)}
                    className="flex-1 py-2 rounded-lg bg-surface-elevated items-center justify-center active:opacity-70"
                  >
                    <Plus size={14} color="#FAFAFA" />
                  </Pressable>
                </View>
              </View>

              {/* End Time */}
              <View className="flex-1 rounded-xl bg-surface-canvas border border-surface-stroke p-3">
                <Text className="text-[10px] font-mono uppercase text-brand-dim mb-1">
                  End ({formatDurationCompact(durationMs)})
                </Text>
                <Text className="text-2xl font-mono font-bold text-brand-white mb-2.5">
                  {formatTimeShort(endTime)}
                </Text>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => adjustEnd(-STEP_MS)}
                    className="flex-1 py-2 rounded-lg bg-surface-elevated items-center justify-center active:opacity-70"
                  >
                    <Minus size={14} color="#FAFAFA" />
                  </Pressable>
                  <Pressable
                    onPress={() => adjustEnd(STEP_MS)}
                    className="flex-1 py-2 rounded-lg bg-surface-elevated items-center justify-center active:opacity-70"
                  >
                    <Plus size={14} color="#FAFAFA" />
                  </Pressable>
                </View>
              </View>
            </View>

            {/* Quick Duration Pills */}
            <View className="flex-row gap-2">
              {DURATION_PRESETS_MIN.map((mins) => {
                const active = durationMinutes === mins;
                return (
                  <Pressable
                    key={mins}
                    onPress={() => applyDurationPreset(mins)}
                    className={`flex-1 py-2 rounded-xl border items-center justify-center ${
                      active
                        ? 'bg-brand-white border-brand-white'
                        : 'bg-surface-canvas border-surface-stroke'
                    }`}
                  >
                    <Text
                      className={`text-xs font-mono font-bold ${
                        active ? 'text-surface-canvas' : 'text-brand-muted'
                      }`}
                    >
                      {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Conflict Warning & Safe Slot Recommendation */}
            {conflict ? (
              <View className="rounded-xl bg-status-danger/15 border border-status-danger/50 p-3.5 gap-2.5">
                <View className="flex-row items-start gap-2.5">
                  <AlertTriangle size={18} color="#EF4444" style={{ marginTop: 1 }} />
                  <View className="flex-1">
                    <Text className="text-xs font-mono font-bold uppercase text-status-danger">
                      Schedule Clash Detected
                    </Text>
                    <Text className="text-sm text-brand-white mt-0.5">
                      Overlaps with{' '}
                      <Text className="font-bold">
                        {conflict.title || 'Existing Block'}
                      </Text>{' '}
                      ({formatTimeRange(conflict.startTime, conflict.endTime)}).
                    </Text>
                  </View>
                </View>

                {nextSlot ? (
                  <Pressable
                    onPress={applyNextSlot}
                    className="px-3 py-2.5 rounded-xl bg-surface-canvas border border-status-danger/40 flex-row items-center justify-between active:opacity-80"
                  >
                    <Text className="text-xs font-mono text-brand-white">
                      Next opening:{' '}
                      <Text className="font-bold text-subject-premed">
                        {formatTimeShort(nextSlot.startTime)} –{' '}
                        {formatTimeShort(nextSlot.endTime)}
                      </Text>
                    </Text>
                    <View className="flex-row items-center gap-1">
                      <Text className="text-xs font-bold text-subject-premed">Use Slot</Text>
                      <ArrowRight size={13} color="#10B981" />
                    </View>
                  </Pressable>
                ) : null}
              </View>
            ) : validationError ? (
              <View className="rounded-xl bg-status-danger/15 border border-status-danger/50 p-3">
                <Text className="text-xs font-mono text-status-danger">{validationError}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {/* Submit CTA */}
        <View className="px-5 pb-6 pt-3 border-t border-surface-stroke/60">
          <Pressable
            onPress={handleSave}
            disabled={!canSubmit}
            className={`w-full py-4 rounded-2xl flex-row items-center justify-center gap-2 ${
              canSubmit
                ? 'bg-subject-premed active:opacity-85'
                : 'bg-surface-elevated border border-surface-stroke opacity-60'
            }`}
          >
            <Check size={18} color={canSubmit ? '#09090B' : '#71717A'} strokeWidth={2.5} />
            <Text
              className={`text-base font-bold ${
                canSubmit ? 'text-surface-canvas' : 'text-brand-dim'
              }`}
            >
              {conflict
                ? 'Resolve Clash to Save'
                : isEditing
                ? 'Update Grind Block'
                : 'Lock In Grind Block'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

