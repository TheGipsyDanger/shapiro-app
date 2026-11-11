import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Check,
  Database,
  Images,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createSubject,
  deleteSubject,
  getSubjectsWithStats,
  updateSubject,
} from '@/db/database';
import { useSessionStore } from '@/stores/useSessionStore';
import {
  SUBJECT_CATEGORIES,
  SUBJECT_PALETTE,
  SubjectCategory,
  SubjectWithStats,
} from '@/types/domain';
import { formatDurationCompact } from '@/utils/schedule';

export default function SubjectsManagerScreen() {
  const router = useRouter();
  const scheduleVersion = useSessionStore((s) => s.scheduleVersion);
  const bumpScheduleVersion = useSessionStore((s) => s.bumpScheduleVersion);
  const refreshActiveSession = useSessionStore((s) => s.refreshActiveSession);
  const resetOnboarding = useSessionStore((s) => s.resetOnboarding);

  const [subjects, setSubjects] = useState<SubjectWithStats[]>([]);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SubjectWithStats | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<SubjectCategory>('STEM');
  const [color, setColor] = useState<string>(SUBJECT_PALETTE[0]);

  const loadSubjects = useCallback(() => {
    setSubjects(getSubjectsWithStats());
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSubjects();
    }, [loadSubjects])
  );

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects, scheduleVersion]);

  const openCreateModal = () => {
    Haptics.selectionAsync().catch(() => {});
    setEditingSubject(null);
    setName('');
    setCategory('STEM');
    setColor(SUBJECT_PALETTE[0]);
    setEditorVisible(true);
  };

  const openEditModal = (subj: SubjectWithStats) => {
    Haptics.selectionAsync().catch(() => {});
    setEditingSubject(subj);
    setName(subj.name);
    setCategory(subj.category);
    setColor(subj.color);
    setEditorVisible(true);
  };

  const handleSaveSubject = async () => {
    if (!name.trim()) return;
    if (editingSubject) {
      updateSubject(editingSubject.id, { name: name.trim(), category, color });
    } else {
      createSubject({ name: name.trim(), category, color });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setEditorVisible(false);
    loadSubjects();
    await refreshActiveSession();
    bumpScheduleVersion();
  };

  const handleDeleteSubject = (subj: SubjectWithStats) => {
    if (subjects.length <= 1) {
      Alert.alert('Minimum One Subject', 'Keep at least one subject to schedule study blocks.');
      return;
    }

    Alert.alert(
      `Delete "${subj.name}"?`,
      `This will also delete ${subj.blockCount} study blocks and ${subj.photoCount} vault photos tied to this subject.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            deleteSubject(subj.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            loadSubjects();
            await refreshActiveSession();
            bumpScheduleVersion();
          },
        },
      ]
    );
  };

  const handleReplayOnboarding = async () => {
    Haptics.selectionAsync().catch(() => {});
    await resetOnboarding();
    router.replace('/(onboarding)');
  };

  const totalBlocks = subjects.reduce((acc, s) => acc + s.blockCount, 0);
  const totalPhotos = subjects.reduce((acc, s) => acc + s.photoCount, 0);

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas" edges={['top']}>
      {/* Header */}
      <View className="px-5 pt-2 pb-4 border-b border-surface-stroke/60 flex-row items-center justify-between">
        <View>
          <Text className="text-xs font-mono uppercase tracking-widest text-brand-dim">
            SUBJECT MANAGER
          </Text>
          <Text className="text-2xl font-bold text-brand-white tracking-tight mt-0.5">
            Subjects &amp; Studio
          </Text>
        </View>

        <Pressable
          onPress={openCreateModal}
          className="px-4 py-2.5 rounded-xl bg-brand-white flex-row items-center gap-1.5 active:opacity-85"
        >
          <Plus size={16} color="#09090B" strokeWidth={2.5} />
          <Text className="text-xs font-bold text-surface-canvas">New Subject</Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 40, gap: 12 }}
      >
        {/* Subjects List */}
        {subjects.map((subj) => (
          <View
            key={subj.id}
            style={{ borderLeftColor: subj.color, borderLeftWidth: 4 }}
            className="rounded-2xl bg-surface-subtle border border-surface-stroke p-4 flex-row items-center justify-between gap-3"
          >
            <View className="flex-1 gap-1.5">
              <View className="flex-row items-center gap-2">
                <View
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: subj.color }}
                />
                <Text className="text-base font-bold text-brand-white" numberOfLines={1}>
                  {subj.name}
                </Text>
                <View className="px-2 py-0.5 rounded-md bg-surface-elevated border border-surface-stroke">
                  <Text className="text-[10px] font-mono text-brand-muted">
                    {subj.category}
                  </Text>
                </View>
              </View>

              <View className="flex-row items-center gap-3">
                <Text className="text-xs font-mono text-brand-muted">
                  {subj.blockCount} {subj.blockCount === 1 ? 'block' : 'blocks'} ·{' '}
                  {formatDurationCompact(subj.totalMinutes * 60_000)}
                </Text>
                <View className="flex-row items-center gap-1">
                  <Images size={12} color="#71717A" />
                  <Text className="text-xs font-mono text-brand-dim">{subj.photoCount}</Text>
                </View>
              </View>
            </View>

            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => openEditModal(subj)}
                className="w-9 h-9 rounded-xl bg-surface-elevated border border-surface-stroke items-center justify-center active:opacity-75"
              >
                <Pencil size={15} color="#FAFAFA" />
              </Pressable>

              <Pressable
                onPress={() => handleDeleteSubject(subj)}
                className="w-9 h-9 rounded-xl bg-status-danger/10 border border-status-danger/35 items-center justify-center active:opacity-75"
              >
                <Trash2 size={15} color="#EF4444" />
              </Pressable>
            </View>
          </View>
        ))}

        {/* Local-First Storage & Demo Controls */}
        <View className="mt-4 rounded-2xl bg-surface-subtle border border-surface-stroke p-4 gap-3">
          <View className="flex-row items-center gap-2">
            <Database size={15} color="#10B981" />
            <Text className="text-xs font-mono uppercase tracking-wider text-brand-white">
              Local-First Vault Engine
            </Text>
          </View>
          <Text className="text-xs text-brand-muted leading-5">
            All {totalBlocks} study blocks and {totalPhotos} vault photos are stored offline in SQLite (`shapiro.db`) and your sandboxed `documentDirectory/vault/` folder.
          </Text>

          <Pressable
            onPress={handleReplayOnboarding}
            className="mt-1 px-4 py-3 rounded-xl bg-surface-elevated border border-surface-stroke flex-row items-center justify-center gap-2 active:opacity-80"
          >
            <RotateCcw size={14} color="#FAFAFA" />
            <Text className="text-xs font-semibold text-brand-white">
              Replay Onboarding Carousel
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Create / Edit Subject Modal */}
      <Modal
        visible={editorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditorVisible(false)}
      >
        <View className="flex-1 bg-black/70 justify-end">
          <View className="rounded-t-3xl bg-surface-subtle border-t border-surface-stroke p-6 gap-5">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-bold text-brand-white">
                {editingSubject ? 'Edit Subject' : 'Create Subject'}
              </Text>
              <Pressable
                onPress={() => setEditorVisible(false)}
                className="w-8 h-8 rounded-full bg-surface-elevated items-center justify-center"
              >
                <X size={16} color="#FAFAFA" />
              </Pressable>
            </View>

            <View>
              <Text className="text-xs font-mono uppercase text-brand-muted mb-2">
                Subject Name
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Linear Algebra"
                placeholderTextColor="#71717A"
                autoFocus
                className="px-4 py-3.5 rounded-2xl bg-surface-canvas border border-surface-stroke text-brand-white text-base"
              />
            </View>

            <View>
              <Text className="text-xs font-mono uppercase text-brand-muted mb-2">
                Category
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {SUBJECT_CATEGORIES.map((cat) => {
                  const selected = category === cat.key;
                  return (
                    <Pressable
                      key={cat.key}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setCategory(cat.key);
                        if (!editingSubject) {
                          setColor(cat.defaultColor);
                        }
                      }}
                      className={`px-3 py-2 rounded-xl border ${
                        selected
                          ? 'bg-brand-white border-brand-white'
                          : 'bg-surface-canvas border-surface-stroke'
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          selected ? 'text-surface-canvas' : 'text-brand-muted'
                        }`}
                      >
                        {cat.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View>
              <Text className="text-xs font-mono uppercase text-brand-muted mb-2">
                Color Token
              </Text>
              <View className="flex-row flex-wrap gap-3">
                {SUBJECT_PALETTE.map((swatch) => {
                  const active = color === swatch;
                  return (
                    <Pressable
                      key={swatch}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setColor(swatch);
                      }}
                      style={{ backgroundColor: swatch }}
                      className={`w-10 h-10 rounded-full items-center justify-center ${
                        active ? 'border-2 border-brand-white' : ''
                      }`}
                    >
                      {active ? <Check size={16} color="#09090B" strokeWidth={3} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable
              onPress={handleSaveSubject}
              disabled={!name.trim()}
              className={`w-full py-4 rounded-2xl items-center justify-center mb-3 ${
                name.trim()
                  ? 'bg-subject-premed active:opacity-85'
                  : 'bg-surface-elevated opacity-50'
              }`}
            >
              <Text
                className={`text-base font-bold ${
                  name.trim() ? 'text-surface-canvas' : 'text-brand-dim'
                }`}
              >
                {editingSubject ? 'Save Changes' : 'Create Subject'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

