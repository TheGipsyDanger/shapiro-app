import React, { useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { CalendarCheck2, Camera, FolderLock, ShieldCheck, ArrowRight, Sparkles } from 'lucide-react-native';
import Animated, {
  Extrapolation,
  interpolate,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionStore } from '@/stores/useSessionStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface OnboardingSlide {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  accentColor: string;
  badgeText: string;
  icon: 'calendar' | 'camera' | 'vault' | 'pass';
  highlights: string[];
}

const SLIDES: OnboardingSlide[] = [
  {
    id: 'precision-schedule',
    eyebrow: '01 / DETERMINISTIC TIMELINE',
    title: 'Zero-Overlap\nStudy Blocks.',
    subtitle:
      'Every grind session lives on a strict 06:00–24:00 timeline. Double-booking is mathematically blocked before it starts.',
    accentColor: '#3B82F6',
    badgeText: 'CONFLICT ENGINE ACTIVE',
    icon: 'calendar',
    highlights: ['Strict interval collision detection', 'Instant next-opening gap finder', 'Live NOW breathing cursor'],
  },
  {
    id: 'jit-camera',
    eyebrow: '02 / JUST-IN-TIME FOCUS',
    title: 'No Grind,\nNo Shutter.',
    subtitle:
      'Open Shapiro Cam during off-hours and the viewfinder blurs. Lock in a subject and duration to unlock capture.',
    accentColor: '#10B981',
    badgeText: 'JIT INTERCEPTOR',
    icon: 'camera',
    highlights: ['Blurs viewfinder when slacking', '30m / 1h / 2h smart collision-safe pills', 'Sub-180ms unlock transition'],
  },
  {
    id: 'isolated-vault',
    eyebrow: '03 / ISOLATED STUDY VAULT',
    title: 'Keep Notes Out\nof Camera Roll.',
    subtitle:
      'Whiteboards, problem sets, and diagrams stay sandboxed per study block—never buried under personal photos.',
    accentColor: '#A855F7',
    badgeText: 'SANDBOXED STORAGE',
    icon: 'vault',
    highlights: ['3-column per-block gallery grid', 'Pinch-to-zoom full inspection', 'One-tap album export when ready'],
  },
  {
    id: 'local-first-studio',
    eyebrow: '04 / 100% LOCAL-FIRST',
    title: 'Your Study Studio,\nCompletely Private.',
    subtitle:
      'No cloud accounts, no tracking, no network delays. Everything lives locally on your device, ready whenever you grind.',
    accentColor: '#10B981',
    badgeText: 'OFFLINE READY',
    icon: 'pass',
    highlights: ['Local SQLite + isolated file vault', 'Instant startup, zero network latency', 'Unlimited subjects & study vaults'],
  },
];

function SlideIcon({ icon, color }: { icon: OnboardingSlide['icon']; color: string }) {
  const size = 34;
  switch (icon) {
    case 'calendar':
      return <CalendarCheck2 size={size} color={color} strokeWidth={1.8} />;
    case 'camera':
      return <Camera size={size} color={color} strokeWidth={1.8} />;
    case 'vault':
      return <FolderLock size={size} color={color} strokeWidth={1.8} />;
    case 'pass':
      return <ShieldCheck size={size} color={color} strokeWidth={1.8} />;
  }
}

function SlideItem({
  slide,
  index,
  scrollX,
}: {
  slide: OnboardingSlide;
  index: number;
  scrollX: SharedValue<number>;
}) {
  const animatedCardStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * SCREEN_WIDTH,
      index * SCREEN_WIDTH,
      (index + 1) * SCREEN_WIDTH,
    ];
    const scale = interpolate(scrollX.value, inputRange, [0.92, 1, 0.92], Extrapolation.CLAMP);
    const opacity = interpolate(scrollX.value, inputRange, [0.45, 1, 0.45], Extrapolation.CLAMP);
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  return (
    <View style={{ width: SCREEN_WIDTH }} className="px-6 justify-center">
      <Animated.View
        style={animatedCardStyle}
        className="rounded-3xl bg-surface-subtle border border-surface-stroke p-6"
      >
        <View className="flex-row items-center justify-between mb-6">
          <View
            className="w-16 h-16 rounded-2xl items-center justify-center border border-surface-stroke bg-surface-elevated"
            style={{
              shadowColor: slide.accentColor,
              shadowOpacity: 0.28,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <SlideIcon icon={slide.icon} color={slide.accentColor} />
          </View>

          <View className="px-3 py-1.5 rounded-full bg-surface-elevated border border-surface-stroke">
            <Text
              className="text-[11px] font-mono font-semibold tracking-wider"
              style={{ color: slide.accentColor }}
            >
              {slide.badgeText}
            </Text>
          </View>
        </View>

        <Text className="text-xs font-mono tracking-widest text-brand-dim mb-2">
          {slide.eyebrow}
        </Text>

        <Text className="text-3xl font-bold text-brand-white tracking-tight leading-tight mb-3">
          {slide.title}
        </Text>

        <Text className="text-base text-brand-muted leading-6 mb-6">{slide.subtitle}</Text>

        <View className="border-t border-surface-stroke pt-4 gap-2.5">
          {slide.highlights.map((item) => (
            <View key={item} className="flex-row items-center gap-2.5">
              <View
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: slide.accentColor }}
              />
              <Text className="text-sm text-brand-white/90">{item}</Text>
            </View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

function PaginationDot({
  index,
  scrollX,
}: {
  index: number;
  scrollX: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const inputRange = [
      (index - 1) * SCREEN_WIDTH,
      index * SCREEN_WIDTH,
      (index + 1) * SCREEN_WIDTH,
    ];
    const width = interpolate(scrollX.value, inputRange, [8, 28, 8], Extrapolation.CLAMP);
    const opacity = interpolate(scrollX.value, inputRange, [0.35, 1, 0.35], Extrapolation.CLAMP);
    return {
      width,
      opacity,
    };
  });

  return (
    <Animated.View
      style={animatedStyle}
      className="h-2 rounded-full bg-brand-white"
    />
  );
}

export default function OnboardingScreen() {
  const router = useRouter();
  const completeOnboarding = useSessionStore((s) => s.completeOnboarding);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const scrollX = useSharedValue(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFinishing, setIsFinishing] = useState(false);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const handleMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActiveIndex(idx);
  };

  const handleFinish = async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await completeOnboarding();
    router.replace('/(tabs)');
  };

  const handleNext = () => {
    if (activeIndex >= SLIDES.length - 1) {
      handleFinish();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const nextIdx = activeIndex + 1;
    setActiveIndex(nextIdx);
    scrollRef.current?.scrollTo({ x: nextIdx * SCREEN_WIDTH, animated: true });
  };

  const isLastSlide = activeIndex === SLIDES.length - 1;

  return (
    <SafeAreaView className="flex-1 bg-surface-canvas">
      {/* Header */}
      <View className="px-6 pt-3 pb-2 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View className="w-2.5 h-2.5 rounded-full bg-subject-premed" />
          <Text className="text-sm font-mono font-bold tracking-[0.22em] text-brand-white">
            SHAPIRO
          </Text>
        </View>

        {!isLastSlide ? (
          <Pressable
            onPress={handleFinish}
            hitSlop={12}
            className="px-3 py-1.5 rounded-full bg-surface-subtle border border-surface-stroke active:opacity-75"
          >
            <Text className="text-xs font-mono text-brand-muted">Skip</Text>
          </Pressable>
        ) : (
          <View className="px-3 py-1.5 rounded-full bg-surface-subtle border border-surface-stroke">
            <Text className="text-xs font-mono text-subject-premed">OFFLINE PRO</Text>
          </View>
        )}
      </View>

      {/* Carousel */}
      <View className="flex-1 justify-center">
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          onMomentumScrollEnd={handleMomentumEnd}
          decelerationRate="fast"
        >
          {SLIDES.map((slide, index) => (
            <SlideItem key={slide.id} slide={slide} index={index} scrollX={scrollX} />
          ))}
        </Animated.ScrollView>
      </View>

      {/* Footer Pagination & CTA */}
      <View className="px-6 pb-6 pt-2 gap-5">
        <View className="flex-row items-center justify-center gap-2">
          {SLIDES.map((slide, index) => (
            <PaginationDot key={slide.id} index={index} scrollX={scrollX} />
          ))}
        </View>

        {isLastSlide ? (
          <Pressable
            onPress={handleFinish}
            disabled={isFinishing}
            className="w-full py-4 rounded-2xl bg-subject-premed flex-row items-center justify-center gap-2.5 active:opacity-85"
            style={{
              shadowColor: '#10B981',
              shadowOpacity: 0.45,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 6 },
            }}
          >
            <Sparkles size={18} color="#09090B" strokeWidth={2.2} />
            <Text className="text-base font-bold text-surface-canvas tracking-tight">
              Enter Shapiro Studio
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleNext}
            className="w-full py-4 rounded-2xl bg-brand-white flex-row items-center justify-center gap-2 active:opacity-85"
          >
            <Text className="text-base font-bold text-surface-canvas">Continue</Text>
            <ArrowRight size={18} color="#09090B" strokeWidth={2.2} />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

