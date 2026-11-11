import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';
import { format } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Download,
  FolderLock,
  Pencil,
  Trash2,
  X,
} from 'lucide-react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  initialWindowMetrics,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  deleteVaultPhoto,
  getStudyBlockById,
  getVaultPhotosForBlock,
} from '@/db/database';
import { useSessionStore } from '@/stores/useSessionStore';
import type { StudyBlockWithSubject, VaultPhoto } from '@/types/domain';
import { formatTimeRange } from '@/utils/schedule';
import { exportBlockPhotosToCameraRoll } from '@/utils/vaultStorage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function ZoomablePhotoModal({
  photo,
  topInsetFallback,
  bottomInsetFallback,
  onClose,
  onDelete,
}: {
  photo: VaultPhoto | null;
  topInsetFallback: number;
  bottomInsetFallback: number;
  onClose: () => void;
  onDelete: (photo: VaultPhoto) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedX.value = 0;
    savedY.value = 0;
  }, [photo, savedScale, savedX, savedY, scale, translateX, translateY]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.min(5, Math.max(1, savedScale.value * e.scale));
      scale.value = next;
    })
    .onEnd(() => {
      if (scale.value < 1.05) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedX.value = 0;
        savedY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        translateX.value = savedX.value + e.translationX;
        translateY.value = savedY.value + e.translationY;
      }
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedX.value = 0;
        savedY.value = 0;
      } else {
        savedX.value = translateX.value;
        savedY.value = translateY.value;
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.1) {
        scale.value = withTiming(1, { duration: 200 });
        savedScale.value = 1;
        translateX.value = withTiming(0, { duration: 200 });
        translateY.value = withTiming(0, { duration: 200 });
        savedX.value = 0;
        savedY.value = 0;
      } else {
        scale.value = withTiming(2.4, { duration: 220 });
        savedScale.value = 2.4;
      }
    });

  const composedGesture = Gesture.Simultaneous(
    pinchGesture,
    panGesture,
    doubleTapGesture
  );

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (!photo) return null;

  const sizeKb = Math.max(1, Math.round(photo.fileSizeBytes / 1024));

  const topPadding =
    Math.max(topInsetFallback, initialWindowMetrics?.insets.top ?? 0, 20) + 10;
  const bottomPadding =
    Math.max(bottomInsetFallback, initialWindowMetrics?.insets.bottom ?? 0, 16) + 6;

  return (
    <Modal
      visible={Boolean(photo)}
      transparent={false}
      presentationStyle="fullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#09090B' }}>
        <View
          style={{
            flex: 1,
            backgroundColor: '#09090B',
            paddingTop: topPadding,
            paddingBottom: bottomPadding,
            justifyContent: 'space-between',
          }}
        >
          {/* Top Bar */}
          <View
            style={{ zIndex: 30, elevation: 30 }}
            className="px-5 py-3 flex-row items-center justify-between bg-surface-canvas border-b border-surface-stroke/50"
          >
            <Pressable
              onPress={onClose}
              hitSlop={14}
              className="h-11 px-3.5 rounded-full bg-surface-subtle border border-surface-stroke flex-row items-center gap-1.5 active:opacity-75"
            >
              <X size={18} color="#FAFAFA" />
              <Text className="text-xs font-semibold text-brand-white">Close</Text>
            </Pressable>

            <View className="items-center px-2 flex-1">
              <Text className="text-xs font-mono font-bold text-brand-white">
                {format(new Date(photo.capturedAt), 'HH:mm:ss')}
              </Text>
              <Text className="text-[10px] font-mono text-brand-muted" numberOfLines={1}>
                {sizeKb} KB · Pinch to zoom
              </Text>
            </View>

            <Pressable
              onPress={() => onDelete(photo)}
              hitSlop={14}
              className="h-11 px-3.5 rounded-full bg-status-danger/15 border border-status-danger/50 flex-row items-center gap-1.5 active:opacity-75"
            >
              <Trash2 size={16} color="#EF4444" />
              <Text className="text-xs font-semibold text-status-danger">Delete</Text>
            </Pressable>
          </View>

          {/* Pinch-to-Zoom Image Stage */}
          <View className="flex-1 items-center justify-center overflow-hidden">
            <GestureDetector gesture={composedGesture}>
              <Animated.View style={animatedImageStyle}>
                <Image
                  source={{ uri: photo.filePath }}
                  style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.66 }}
                  resizeMode="contain"
                />
              </Animated.View>
            </GestureDetector>
          </View>

          <View className="pt-2 pb-1 items-center bg-surface-canvas z-30">
            <Text className="text-[11px] font-mono text-brand-dim">
              ISOLATED VAULT FILE · DOUBLE-TAP OR PINCH TO ZOOM
            </Text>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export default function StudyVaultScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ blockId: string }>();
  const blockId = typeof params.blockId === 'string' ? params.blockId : '';

  const activeBlock = useSessionStore((s) => s.activeBlock);
  const bumpScheduleVersion = useSessionStore((s) => s.bumpScheduleVersion);
  const refreshActiveSession = useSessionStore((s) => s.refreshActiveSession);

  const [block, setBlock] = useState<StudyBlockWithSubject | null>(null);
  const [photos, setPhotos] = useState<VaultPhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<VaultPhoto | null>(null);

  const [exportState, setExportState] = useState<{
    exporting: boolean;
    message: string | null;
    done: boolean;
  }>({ exporting: false, message: null, done: false });

  const loadVault = useCallback(() => {
    if (!blockId) return;
    const fetchedBlock = getStudyBlockById(blockId);
    setBlock(fetchedBlock);
    setPhotos(getVaultPhotosForBlock(blockId));
  }, [blockId]);

  useFocusEffect(
    useCallback(() => {
      loadVault();
    }, [loadVault])
  );

  const handleExportAll = async () => {
    if (!block || photos.length === 0 || exportState.exporting) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExportState({
      exporting: true,
      message: `Exporting 0/${photos.length}...`,
      done: false,
    });

    try {
      const result = await exportBlockPhotosToCameraRoll(
        photos,
        block.subjectName,
        (current, total) => {
          setExportState({
            exporting: true,
            message: `Exporting ${current}/${total} to Camera Roll...`,
            done: false,
          });
        }
      );

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setExportState({
        exporting: false,
        message: `Exported ${result.exportedCount} photos to "${result.albumTitle}"`,
        done: true,
      });

      setTimeout(() => {
        setExportState((s) => (s.done ? { exporting: false, message: null, done: false } : s));
      }, 3500);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setExportState({ exporting: false, message: null, done: false });
      Alert.alert(
        'Export Failed',
        err instanceof Error ? err.message : 'Unable to export photos.'
      );
    }
  };

  const handleDeletePhoto = (photo: VaultPhoto) => {
    Alert.alert('Delete Vault Photo?', 'This removes the photo permanently from your Study Vault.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          deleteVaultPhoto(photo.id);
          setSelectedPhoto(null);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          loadVault();
          bumpScheduleVersion();
          await refreshActiveSession();
        },
      },
    ]);
  };

  const isCurrentlyActive = activeBlock?.id === block?.id;

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas" edges={['top']}>
      {/* Header */}
      <View className="px-4 pt-2 pb-3 border-b border-surface-stroke/70 gap-3">
        <View className="flex-row items-center justify-between gap-2">
          <Pressable
            onPress={() => router.back()}
            className="w-9 h-9 rounded-full bg-surface-subtle border border-surface-stroke items-center justify-center active:opacity-75"
          >
            <ArrowLeft size={18} color="#FAFAFA" />
          </Pressable>

          <View className="flex-1 px-1">
            {block ? (
              <View className="flex-row items-center gap-2">
                <View
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: block.subjectColor }}
                />
                <Text
                  className="text-xs font-mono font-bold uppercase tracking-wider"
                  style={{ color: block.subjectColor }}
                  numberOfLines={1}
                >
                  {block.subjectName}
                </Text>
              </View>
            ) : null}
            <Text className="text-lg font-bold text-brand-white" numberOfLines={1}>
              {block ? block.title : 'Study Vault'}
            </Text>
          </View>

          {block ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/modal/add-grind',
                  params: { blockId: block.id },
                })
              }
              className="w-9 h-9 rounded-full bg-surface-subtle border border-surface-stroke items-center justify-center active:opacity-75"
            >
              <Pencil size={15} color="#FAFAFA" />
            </Pressable>
          ) : null}
        </View>

        {block ? (
          <View className="flex-row items-center justify-between gap-2">
            <Text className="text-xs font-mono text-brand-muted">
              {formatTimeRange(block.startTime, block.endTime)} · {photos.length}{' '}
              {photos.length === 1 ? 'photo' : 'photos'}
            </Text>

            <Pressable
              onPress={handleExportAll}
              disabled={photos.length === 0 || exportState.exporting}
              className={`px-3.5 py-2 rounded-xl flex-row items-center gap-1.5 border ${
                photos.length === 0
                  ? 'bg-surface-subtle border-surface-stroke opacity-45'
                  : 'bg-brand-white border-brand-white active:opacity-85'
              }`}
            >
              {exportState.exporting ? (
                <ActivityIndicator size="small" color="#09090B" />
              ) : (
                <Download size={14} color={photos.length === 0 ? '#71717A' : '#09090B'} />
              )}
              <Text
                className={`text-xs font-bold ${
                  photos.length === 0 ? 'text-brand-dim' : 'text-surface-canvas'
                }`}
              >
                Export All to Camera Roll
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Progress / Completion Toast */}
      {exportState.message ? (
        <View
          className={`mx-4 mt-3 px-4 py-3 rounded-2xl border flex-row items-center gap-2.5 ${
            exportState.done
              ? 'bg-status-success/15 border-status-success/50'
              : 'bg-surface-elevated border-surface-stroke'
          }`}
        >
          {exportState.exporting ? (
            <ActivityIndicator size="small" color="#10B981" />
          ) : (
            <CheckCircle2 size={17} color="#22C55E" />
          )}
          <Text className="text-xs font-mono text-brand-white flex-1">
            {exportState.message}
          </Text>
        </View>
      ) : null}

      {/* 3-Column Photo Grid */}
      {!block ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm font-mono text-brand-muted">Study block not found.</Text>
        </View>
      ) : photos.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-16 h-16 rounded-2xl bg-surface-subtle border border-surface-stroke items-center justify-center mb-4">
            <FolderLock size={28} color="#71717A" />
          </View>
          <Text className="text-lg font-bold text-brand-white text-center mb-1.5">
            Vault Is Empty
          </Text>
          <Text className="text-sm text-brand-muted text-center leading-5 mb-6">
            Photos captured during this study block stay isolated here—out of your personal Camera Roll.
          </Text>

          {isCurrentlyActive ? (
            <Pressable
              onPress={() => router.push('/(tabs)/camera')}
              className="px-5 py-3.5 rounded-2xl bg-subject-premed flex-row items-center gap-2 active:opacity-85"
            >
              <Camera size={16} color="#09090B" strokeWidth={2.4} />
              <Text className="text-sm font-bold text-surface-canvas">
                Open Shapiro Cam
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={{ padding: 6, paddingBottom: 40 }}
          columnWrapperStyle={{ gap: 4, marginBottom: 4 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setSelectedPhoto(item);
              }}
              style={{ flex: 1 / 3, aspectRatio: 1 }}
              className="rounded-lg overflow-hidden bg-surface-subtle border border-surface-stroke/60 active:opacity-80"
            >
              <Image
                source={{ uri: item.filePath }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
              <View className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/65">
                <Text className="text-[9px] font-mono text-brand-white">
                  {format(new Date(item.capturedAt), 'HH:mm')}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}

      {/* Fullscreen Pinch-to-Zoom Photo Modal */}
      <ZoomablePhotoModal
        photo={selectedPhoto}
        topInsetFallback={insets.top}
        bottomInsetFallback={insets.bottom}
        onClose={() => setSelectedPhoto(null)}
        onDelete={handleDeletePhoto}
      />
    </SafeAreaView>
  );
}

