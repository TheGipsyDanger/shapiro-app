import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { CameraType, CameraView, FlashMode, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import {
  AlertCircle,
  Camera,
  Clock,
  Images,
  Lock,
  RefreshCw,
  Settings,
  Zap,
  ZapOff,
} from 'lucide-react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createStudyBlock,
  extendStudyBlock,
  getStudyBlockById,
  getSubjects,
  getUpcomingBlocks,
  getVaultPhotosForBlock,
  insertVaultPhoto,
} from '@/db/database';
import { useSessionStore } from '@/stores/useSessionStore';
import type { StudyBlockWithSubject, Subject } from '@/types/domain';
import {
  detectScheduleConflict,
  formatCountdownMMSS,
  formatTimeShort,
} from '@/utils/schedule';
import {
  createSimulatorSampleVaultPhoto,
  hasSufficientDiskSpace,
  InsufficientStorageError,
  saveCapturedPhotoToVault,
} from '@/utils/vaultStorage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const JIT_DURATIONS = [
  { label: '30m', minutes: 30, ms: 30 * 60_000 },
  { label: '1h', minutes: 60, ms: 60 * 60_000 },
  { label: '2h', minutes: 120, ms: 120 * 60_000 },
] as const;

const THIRTY_MIN_MS = 30 * 60_000;

export default function ShapiroCamScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const cameraRef = useRef<CameraView>(null);

  const [permission, requestPermission] = useCameraPermissions();

  const activeBlock = useSessionStore((s) => s.activeBlock);
  const remainingSeconds = useSessionStore((s) => s.remainingSeconds);
  const refreshActiveSession = useSessionStore((s) => s.refreshActiveSession);
  const setTick = useSessionStore((s) => s.setTick);
  const bumpScheduleVersion = useSessionStore((s) => s.bumpScheduleVersion);

  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [selectedDurationMin, setSelectedDurationMin] = useState<number>(60);
  const [upcomingBlocks, setUpcomingBlocks] = useState<StudyBlockWithSubject[]>([]);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const [sessionPhotoCount, setSessionPhotoCount] = useState(0);
  const [lastCapturedUri, setLastCapturedUri] = useState<string | null>(null);
  const [flyingUri, setFlyingUri] = useState<string | null>(null);

  // Mid-camera expiry modal state (Section 9.3)
  const [expiredBlock, setExpiredBlock] = useState<StudyBlockWithSubject | null>(null);

  // BlurView unlock transition (<= 180ms per Section 8 Screen 04/05)
  const blurOverlayOpacity = useSharedValue(1);
  const [showBlurLayer, setShowBlurLayer] = useState(true);

  // Flying thumbnail animation values
  const flyProgress = useSharedValue(0);
  const badgeScale = useSharedValue(1);

  const syncContext = useCallback(async () => {
    const now = Date.now();
    setNowTick(now);
    const loadedSubjects = getSubjects();
    setSubjects(loadedSubjects);
    setSelectedSubjectId((prev) => prev || loadedSubjects[0]?.id || '');

    const upcoming = getUpcomingBlocks(now);
    setUpcomingBlocks(upcoming);

    const active = await refreshActiveSession();
    if (active) {
      const photos = getVaultPhotosForBlock(active.id);
      setSessionPhotoCount(photos.length);
      setLastCapturedUri(photos[0]?.filePath ?? null);
      setExpiredBlock(null);
      setShowBlurLayer(false);
      blurOverlayOpacity.value = 0;
    } else {
      setSessionPhotoCount(0);
      setShowBlurLayer(true);
      blurOverlayOpacity.value = 1;
    }
  }, [blurOverlayOpacity, refreshActiveSession]);

  // Check active event on viewfinder focus
  useEffect(() => {
    if (isFocused) {
      syncContext();
    }
  }, [isFocused, syncContext]);

  // 1-second session countdown & mid-camera expiry detector (Section 9.3)
  useEffect(() => {
    if (!isFocused) return;

    const timer = setInterval(() => {
      const now = Date.now();
      setNowTick(now);

      if (!activeBlock) return;
      const secs = Math.max(0, Math.ceil((activeBlock.endTime - now) / 1000));
      setTick(secs);

      if (now >= activeBlock.endTime && !expiredBlock) {
        const latestBlock = getStudyBlockById(activeBlock.id) ?? activeBlock;
        setExpiredBlock(latestBlock);
        setUpcomingBlocks(getUpcomingBlocks(now));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [activeBlock, expiredBlock, isFocused, setTick]);

  // Evaluate which JIT durations collide with upcoming blocks
  const jitDurationOptions = useMemo(() => {
    return JIT_DURATIONS.map((opt) => {
      const candidateEnd = nowTick + opt.ms;
      const clash = detectScheduleConflict(
        { startTime: nowTick, endTime: candidateEnd },
        upcomingBlocks
      );
      return {
        ...opt,
        clash,
        disabled: clash !== null,
      };
    });
  }, [nowTick, upcomingBlocks]);

  // Auto-select a valid non-colliding JIT duration if current choice collides
  useEffect(() => {
    const current = jitDurationOptions.find((o) => o.minutes === selectedDurationMin);
    if (current?.disabled) {
      const firstValid = jitDurationOptions.find((o) => !o.disabled);
      if (firstValid) {
        setSelectedDurationMin(firstValid.minutes);
      }
    }
  }, [jitDurationOptions, selectedDurationMin]);

  // Check if 30m extension collides with next block
  const extensionConflict = useMemo(() => {
    if (!expiredBlock) return null;
    const candidateEnd = Math.max(expiredBlock.endTime, nowTick) + THIRTY_MIN_MS;
    return detectScheduleConflict(
      { id: expiredBlock.id, startTime: expiredBlock.startTime, endTime: candidateEnd },
      upcomingBlocks
    );
  }, [expiredBlock, nowTick, upcomingBlocks]);

  const handleStartJitGrind = async () => {
    const chosenSubject = subjects.find((s) => s.id === selectedSubjectId) ?? subjects[0];
    const chosenDuration = jitDurationOptions.find((o) => o.minutes === selectedDurationMin);
    if (!chosenSubject || !chosenDuration || chosenDuration.disabled) return;

    const startTime = Date.now();
    const endTime = startTime + chosenDuration.ms;

    try {
      createStudyBlock({
        subjectId: chosenSubject.id,
        title: `${chosenSubject.name} · JIT Grind`,
        startTime,
        endTime,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await refreshActiveSession();
      bumpScheduleVersion();

      // Remove BlurView in <= 180ms (150ms animation)
      blurOverlayOpacity.value = withTiming(
        0,
        { duration: 150, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) {
            runOnJS(setShowBlurLayer)(false);
          }
        }
      );
    } catch (err) {
      Alert.alert(
        'Cannot Start Grind',
        err instanceof Error ? err.message : 'Schedule conflict detected.'
      );
      syncContext();
    }
  };

  const triggerFlyingThumbnail = useCallback(
    (uri: string) => {
      setFlyingUri(uri);
      flyProgress.value = 0;
      flyProgress.value = withTiming(
        1,
        { duration: 480, easing: Easing.bezier(0.22, 1, 0.36, 1) },
        (finished) => {
          if (finished) {
            runOnJS(setFlyingUri)(null);
          }
        }
      );
      badgeScale.value = withSequence(
        withTiming(1.28, { duration: 150 }),
        withTiming(1, { duration: 220 })
      );
    },
    [badgeScale, flyProgress]
  );

  const handleShutterPress = async () => {
    if (!activeBlock || isCapturing || expiredBlock) return;

    // Storage safeguard (Section 9.2)
    const storage = hasSufficientDiskSpace();
    if (!storage.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert(
        'Low Storage Safeguard',
        'Less than 500 MB of free disk space remains. Free up space before capturing more study photos.'
      );
      return;
    }

    setIsCapturing(true);
    try {
      let saved: { filePath: string; fileSizeBytes: number };

      if (cameraRef.current && isCameraReady) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.85,
            skipProcessing: false,
          });
          saved = await saveCapturedPhotoToVault(
            photo.uri,
            activeBlock.subjectId,
            activeBlock.id
          );
        } catch (camErr) {
          // On iOS Simulator without hardware camera, fall back cleanly so vault & export can still be tested
          if (!Device.isDevice) {
            saved = await createSimulatorSampleVaultPhoto(
              activeBlock.subjectId,
              activeBlock.id,
              activeBlock.subjectColor,
              sessionPhotoCount + 1
            );
          } else {
            throw camErr;
          }
        }
      } else if (!Device.isDevice) {
        saved = await createSimulatorSampleVaultPhoto(
          activeBlock.subjectId,
          activeBlock.id,
          activeBlock.subjectColor,
          sessionPhotoCount + 1
        );
      } else {
        throw new Error('Camera is still initializing. Please try again.');
      }

      insertVaultPhoto({
        studyBlockId: activeBlock.id,
        filePath: saved.filePath,
        fileSizeBytes: saved.fileSizeBytes,
      });

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setSessionPhotoCount((c) => c + 1);
      setLastCapturedUri(saved.filePath);
      bumpScheduleVersion();
      triggerFlyingThumbnail(saved.filePath);
    } catch (err) {
      if (err instanceof InsufficientStorageError) {
        Alert.alert('Low Storage Safeguard', err.message);
      } else {
        Alert.alert(
          'Capture Failed',
          err instanceof Error ? err.message : 'Unable to save photo to Study Vault.'
        );
      }
    } finally {
      setIsCapturing(false);
    }
  };

  const handleExtend30m = async () => {
    if (!expiredBlock || extensionConflict) return;
    try {
      const updated = extendStudyBlock(expiredBlock.id, THIRTY_MIN_MS);
      if (updated) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setExpiredBlock(null);
        await refreshActiveSession();
        bumpScheduleVersion();
      }
    } catch (err) {
      Alert.alert(
        'Extension Blocked',
        err instanceof Error ? err.message : 'Collides with an upcoming block.'
      );
    }
  };

  const handleWrapUp = async (openVault: boolean) => {
    const targetBlockId = expiredBlock?.id;
    setExpiredBlock(null);
    await refreshActiveSession();
    setShowBlurLayer(true);
    blurOverlayOpacity.value = 1;

    if (openVault && targetBlockId) {
      router.push({
        pathname: '/vault/[blockId]',
        params: { blockId: targetBlockId },
      });
    }
  };

  const blurAnimatedStyle = useAnimatedStyle(() => ({
    opacity: blurOverlayOpacity.value,
  }));

  const flyingAnimatedStyle = useAnimatedStyle(() => {
    const startX = SCREEN_WIDTH / 2 - 34;
    const startY = SCREEN_HEIGHT - 190;
    const targetX = SCREEN_WIDTH - 86;
    const targetY = 64;

    const x = startX + (targetX - startX) * flyProgress.value;
    const y = startY + (targetY - startY) * flyProgress.value;
    const scale = 1 - 0.62 * flyProgress.value;
    const opacity = flyProgress.value < 0.85 ? 1 : (1 - flyProgress.value) / 0.15;

    return {
      transform: [{ translateX: x }, { translateY: y }, { scale }],
      opacity,
    };
  });

  const badgeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }],
  }));

  // Camera Permission Gate (Section 9.1)
  if (!permission) {
    return (
      <SafeAreaView className="flex-1 bg-surface-canvas items-center justify-center">
        <Text className="text-sm font-mono text-brand-muted">Checking camera access...</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 bg-surface-canvas px-6 justify-center">
        <View className="rounded-3xl bg-surface-subtle border border-surface-stroke p-6 items-center">
          <View className="w-16 h-16 rounded-2xl bg-surface-elevated border border-surface-stroke items-center justify-center mb-5">
            <Camera size={30} color="#10B981" />
          </View>
          <Text className="text-xl font-bold text-brand-white text-center mb-2">
            Camera Access Required
          </Text>
          <Text className="text-sm text-brand-muted text-center leading-6 mb-6">
            Shapiro Cam captures whiteboards and notes straight into your isolated Study Vault—never your personal Camera Roll.
          </Text>

          {permission.canAskAgain ? (
            <Pressable
              onPress={requestPermission}
              className="w-full py-3.5 rounded-2xl bg-subject-premed items-center justify-center mb-3 active:opacity-85"
            >
              <Text className="text-sm font-bold text-surface-canvas">Grant Camera Access</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => Linking.openSettings()}
            className="w-full py-3.5 rounded-2xl bg-surface-elevated border border-surface-stroke flex-row items-center justify-center gap-2 active:opacity-85"
          >
            <Settings size={16} color="#FAFAFA" />
            <Text className="text-sm font-semibold text-brand-white">Open iOS Settings</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const minutesLeft = Math.max(1, Math.ceil(remainingSeconds / 60));
  const selectedJitDuration = jitDurationOptions.find((o) => o.minutes === selectedDurationMin);
  const canStartJit = Boolean(subjects.length > 0 && selectedJitDuration && !selectedJitDuration.disabled);

  return (
    <View className="flex-1 bg-surface-canvas">
      {/* Live Camera Viewfinder */}
      {isFocused ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          onCameraReady={() => setIsCameraReady(true)}
        />
      ) : (
        <View style={StyleSheet.absoluteFill} className="bg-surface-canvas" />
      )}

      {/* Simulator Visual Hint (only on iOS Simulator with no hardware camera) */}
      {!Device.isDevice && activeBlock && !showBlurLayer ? (
        <View
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center px-8"
        >
          <View className="px-4 py-3 rounded-2xl bg-surface-canvas/75 border border-surface-stroke items-center">
            <Text className="text-[11px] font-mono uppercase tracking-widest text-subject-premed mb-1">
              iOS SIMULATOR PREVIEW
            </Text>
            <Text className="text-xs text-brand-muted text-center">
              Hardware camera is absent on Simulator. Shutter generates a local study-note image into your Vault.
            </Text>
          </View>
        </View>
      ) : null}

      {/* Flying Thumbnail Animation Overlay */}
      {flyingUri ? (
        <Animated.View
          pointerEvents="none"
          style={[flyingAnimatedStyle, { position: 'absolute', top: 0, left: 0, zIndex: 40 }]}
        >
          <Image
            source={{ uri: flyingUri }}
            className="w-16 h-20 rounded-xl border-2 border-subject-premed"
          />
        </Animated.View>
      ) : null}

      {/* Screen 04: Active Session HUD */}
      {activeBlock ? (
        <SafeAreaView className="flex-1 justify-between" pointerEvents="box-none">
          {/* Top Glass Pill + Vault Badge */}
          <View className="px-4 pt-2 flex-row items-center justify-between gap-2">
            <BlurView
              intensity={45}
              tint="dark"
              className="flex-1 rounded-full overflow-hidden border border-white/15"
            >
              <View className="px-4 py-2.5 flex-row items-center justify-between gap-2 bg-surface-canvas/45">
                <View className="flex-row items-center gap-2.5 flex-1">
                  <View
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: activeBlock.subjectColor }}
                  />
                  <Text
                    className="text-sm font-semibold text-brand-white flex-shrink"
                    numberOfLines={1}
                  >
                    {activeBlock.subjectName}
                  </Text>
                  <Text className="text-xs font-mono text-brand-muted">
                    • {minutesLeft}m
                  </Text>
                </View>

                <Text className="text-xs font-mono font-bold text-subject-premed">
                  {formatCountdownMMSS(remainingSeconds)}
                </Text>
              </View>
            </BlurView>

            <Animated.View style={badgeAnimatedStyle}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  router.push({
                    pathname: '/vault/[blockId]',
                    params: { blockId: activeBlock.id },
                  });
                }}
                className="px-3.5 py-2.5 rounded-full bg-surface-canvas/80 border border-white/20 flex-row items-center gap-1.5 active:opacity-80"
              >
                <Images size={15} color="#FAFAFA" />
                <Text className="text-xs font-mono font-bold text-brand-white">
                  {sessionPhotoCount}
                </Text>
              </Pressable>
            </Animated.View>
          </View>

          {/* Bottom Shutter Bar */}
          <View className="px-6 pb-6">
            <View className="flex-row items-center justify-between">
              {/* Last Vault Photo Preview */}
              <Pressable
                onPress={() => {
                  router.push({
                    pathname: '/vault/[blockId]',
                    params: { blockId: activeBlock.id },
                  });
                }}
                className="w-13 h-13 rounded-2xl bg-surface-subtle/90 border border-white/20 items-center justify-center overflow-hidden"
                style={{ width: 52, height: 52 }}
              >
                {lastCapturedUri ? (
                  <Image
                    source={{ uri: lastCapturedUri }}
                    style={{ width: 52, height: 52 }}
                    resizeMode="cover"
                  />
                ) : (
                  <Images size={20} color="#A1A1AA" />
                )}
              </Pressable>

              {/* Primary Shutter Button */}
              <Pressable
                onPress={handleShutterPress}
                disabled={isCapturing || Boolean(expiredBlock)}
                className="w-20 h-20 rounded-full border-4 border-brand-white items-center justify-center active:scale-95"
              >
                <View
                  className={`w-16 h-16 rounded-full ${
                    isCapturing ? 'bg-subject-premed' : 'bg-brand-white'
                  }`}
                />
              </Pressable>

              {/* Flash & Flip Controls */}
              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setFlash((f) => (f === 'off' ? 'on' : 'off'));
                  }}
                  className="w-11 h-11 rounded-full bg-surface-canvas/75 border border-white/20 items-center justify-center active:opacity-75"
                >
                  {flash === 'on' ? (
                    <Zap size={18} color="#F59E0B" />
                  ) : (
                    <ZapOff size={18} color="#FAFAFA" />
                  )}
                </Pressable>

                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setFacing((c) => (c === 'back' ? 'front' : 'back'));
                  }}
                  className="w-11 h-11 rounded-full bg-surface-canvas/75 border border-white/20 items-center justify-center active:opacity-75"
                >
                  <RefreshCw size={18} color="#FAFAFA" />
                </Pressable>
              </View>
            </View>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Screen 05: JIT Interceptor Blur + Non-Dismissible Sheet */}
      {showBlurLayer ? (
        <Animated.View style={[StyleSheet.absoluteFill, blurAnimatedStyle, { zIndex: 30 }]}>
          <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />

          <SafeAreaView className="flex-1 justify-end bg-black/35">
            <View className="mx-3 mb-3 rounded-3xl bg-surface-subtle/95 border border-surface-stroke p-5 gap-4">
              {/* Interceptor Header */}
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2.5">
                  <View className="w-9 h-9 rounded-xl bg-subject-cram/15 border border-subject-cram/40 items-center justify-center">
                    <Lock size={17} color="#F43F5E" />
                  </View>
                  <View>
                    <Text className="text-xs font-mono uppercase tracking-wider text-subject-cram">
                      JIT INTERCEPTOR · NO ACTIVE GRIND
                    </Text>
                    <Text className="text-lg font-bold text-brand-white">
                      Declare Focus to Unlock
                    </Text>
                  </View>
                </View>
              </View>

              {/* Subject Chips */}
              <View>
                <Text className="text-[11px] font-mono uppercase tracking-wider text-brand-muted mb-2">
                  Select Subject
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {subjects.map((subj) => {
                    const selected = subj.id === selectedSubjectId;
                    return (
                      <Pressable
                        key={subj.id}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setSelectedSubjectId(subj.id);
                        }}
                        style={{
                          borderColor: selected ? subj.color : '#3F3F46',
                          backgroundColor: selected ? `${subj.color}24` : '#09090B',
                        }}
                        className="px-3.5 py-2 rounded-xl border flex-row items-center gap-2"
                      >
                        <View
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: subj.color }}
                        />
                        <Text className="text-sm font-semibold text-brand-white">
                          {subj.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Fast Duration Pills (30m, 1h, 2h) with collision guard */}
              <View>
                <Text className="text-[11px] font-mono uppercase tracking-wider text-brand-muted mb-2">
                  Grind Duration
                </Text>
                <View className="flex-row gap-2.5">
                  {jitDurationOptions.map((opt) => {
                    const active = selectedDurationMin === opt.minutes && !opt.disabled;
                    return (
                      <Pressable
                        key={opt.label}
                        disabled={opt.disabled}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setSelectedDurationMin(opt.minutes);
                        }}
                        className={`flex-1 py-3 rounded-2xl border items-center justify-center ${
                          opt.disabled
                            ? 'bg-surface-canvas/50 border-status-danger/40 opacity-45'
                            : active
                            ? 'bg-brand-white border-brand-white'
                            : 'bg-surface-canvas border-surface-stroke'
                        }`}
                      >
                        <Text
                          className={`text-base font-mono font-bold ${
                            opt.disabled
                              ? 'text-status-danger'
                              : active
                              ? 'text-surface-canvas'
                              : 'text-brand-white'
                          }`}
                        >
                          {opt.label}
                        </Text>
                        {opt.clash ? (
                          <Text
                            className="text-[9px] font-mono text-status-danger mt-0.5 px-1"
                            numberOfLines={1}
                          >
                            @ {formatTimeShort(opt.clash.startTime)}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>

                {jitDurationOptions.some((o) => o.disabled) ? (
                  <Text className="text-[11px] font-mono text-brand-muted mt-2">
                    Some durations are locked to prevent colliding with your next scheduled block.
                  </Text>
                ) : null}
              </View>

              {/* Primary CTA */}
              <Pressable
                onPress={handleStartJitGrind}
                disabled={!canStartJit}
                className={`w-full py-4 rounded-2xl items-center justify-center flex-row gap-2 ${
                  canStartJit
                    ? 'bg-subject-premed active:opacity-85'
                    : 'bg-surface-elevated border border-surface-stroke opacity-60'
                }`}
                style={
                  canStartJit
                    ? {
                        shadowColor: '#10B981',
                        shadowOpacity: 0.45,
                        shadowRadius: 16,
                        shadowOffset: { width: 0, height: 4 },
                      }
                    : undefined
                }
              >
                <Camera size={18} color={canStartJit ? '#09090B' : '#71717A'} strokeWidth={2.4} />
                <Text
                  className={`text-base font-bold ${
                    canStartJit ? 'text-surface-canvas' : 'text-brand-dim'
                  }`}
                >
                  {canStartJit
                    ? 'Start Grind & Unlock Camera'
                    : 'All Slots Collide With Next Block'}
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </Animated.View>
      ) : null}

      {/* Section 9.3: Mid-Camera Session Expiry Sheet */}
      {expiredBlock ? (
        <View
          style={[StyleSheet.absoluteFill, { zIndex: 50 }]}
          className="bg-black/75 justify-center px-5"
        >
          <View className="rounded-3xl bg-surface-subtle border border-surface-stroke p-6 gap-4">
            <View className="flex-row items-center gap-3">
              <View className="w-11 h-11 rounded-2xl bg-subject-humanities/20 border border-subject-humanities/50 items-center justify-center">
                <Clock size={22} color="#F59E0B" />
              </View>
              <View className="flex-1">
                <Text className="text-xs font-mono uppercase tracking-wider text-subject-humanities">
                  SESSION COMPLETE
                </Text>
                <Text className="text-xl font-bold text-brand-white">
                  Grind ended!
                </Text>
              </View>
            </View>

            <Text className="text-sm text-brand-muted leading-5">
              Your <Text className="text-brand-white font-semibold">{expiredBlock.title}</Text> block finished. Extend 30m or wrap up and review your Study Vault?
            </Text>

            {extensionConflict ? (
              <View className="p-3 rounded-xl bg-status-danger/15 border border-status-danger/40 flex-row items-center gap-2">
                <AlertCircle size={16} color="#EF4444" />
                <Text className="text-xs font-mono text-status-danger flex-1">
                  Cannot extend 30m: collides with &ldquo;{extensionConflict.title || 'next block'}&rdquo; at{' '}
                  {formatTimeShort(extensionConflict.startTime)}.
                </Text>
              </View>
            ) : null}

            <View className="gap-2.5 mt-1">
              <Pressable
                onPress={handleExtend30m}
                disabled={Boolean(extensionConflict)}
                className={`w-full py-3.5 rounded-2xl items-center justify-center ${
                  extensionConflict
                    ? 'bg-surface-elevated border border-surface-stroke opacity-50'
                    : 'bg-subject-premed active:opacity-85'
                }`}
              >
                <Text
                  className={`text-sm font-bold ${
                    extensionConflict ? 'text-brand-dim' : 'text-surface-canvas'
                  }`}
                >
                  Extend 30m
                </Text>
              </Pressable>

              <Pressable
                onPress={() => handleWrapUp(true)}
                className="w-full py-3.5 rounded-2xl bg-brand-white items-center justify-center active:opacity-85"
              >
                <Text className="text-sm font-bold text-surface-canvas">
                  Wrap Up &amp; Open Vault ({sessionPhotoCount})
                </Text>
              </Pressable>

              <Pressable
                onPress={() => handleWrapUp(false)}
                className="w-full py-3 rounded-2xl bg-surface-elevated border border-surface-stroke items-center justify-center active:opacity-80"
              >
                <Text className="text-sm font-semibold text-brand-muted">Wrap Up</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
