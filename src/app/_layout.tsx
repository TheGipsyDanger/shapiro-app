import '../global.css';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { initializeDatabase } from '@/db/database';
import { useSessionStore } from '@/stores/useSessionStore';

SplashScreen.preventAutoHideAsync().catch(() => {});

const SHAPIRO_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#09090B',
    card: '#18181B',
    text: '#FAFAFA',
    border: '#3F3F46',
    primary: '#10B981',
  },
};

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const refreshActiveSession = useSessionStore((s) => s.refreshActiveSession);
  const loadOnboardingState = useSessionStore((s) => s.loadOnboardingState);
  const hasOnboarded = useSessionStore((s) => s.hasOnboarded);

  const [isBootReady, setIsBootReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      try {
        initializeDatabase();
        await Promise.all([refreshActiveSession(), loadOnboardingState()]);
        if (mounted) {
          setIsBootReady(true);
        }
      } catch (err) {
        console.error('Failed to boot Shapiro:', err);
        if (mounted) {
          setIsBootReady(true);
        }
      } finally {
        SplashScreen.hideAsync().catch(() => {});
      }
    }
    boot();
    return () => {
      mounted = false;
    };
  }, [refreshActiveSession, loadOnboardingState]);

  useEffect(() => {
    if (!isBootReady || hasOnboarded === null) return;
    const inOnboarding = segments[0] === '(onboarding)';

    if (!hasOnboarded && !inOnboarding) {
      router.replace('/(onboarding)');
    } else if (hasOnboarded && inOnboarding) {
      router.replace('/(tabs)');
    }
  }, [isBootReady, hasOnboarded, segments, router]);

  if (!isBootReady) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-canvas">
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#09090B' }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider value={SHAPIRO_THEME}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#09090B' },
            }}
          >
            <Stack.Screen name="(onboarding)/index" options={{ animation: 'fade' }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen
              name="modal/add-grind"
              options={{
                presentation: 'modal',
                animation: 'slide_from_bottom',
                contentStyle: { backgroundColor: '#09090B' },
              }}
            />
            <Stack.Screen
              name="vault/[blockId]"
              options={{
                animation: 'slide_from_right',
                contentStyle: { backgroundColor: '#09090B' },
              }}
            />
          </Stack>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
