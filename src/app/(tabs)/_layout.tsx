import React from 'react';
import { Platform, View } from 'react-native';
import { Tabs } from 'expo-router';
import { CalendarDays, Camera, Layers } from 'lucide-react-native';
import { useSessionStore } from '@/stores/useSessionStore';

export default function TabsLayout() {
  const currentBlockId = useSessionStore((s) => s.currentBlockId);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#09090B',
          borderTopColor: '#27272A',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
        },
        tabBarActiveTintColor: '#FAFAFA',
        tabBarInactiveTintColor: '#71717A',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Schedule',
          tabBarIcon: ({ color, size }) => (
            <CalendarDays size={size - 2} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="camera/index"
        options={{
          title: 'Shapiro Cam',
          tabBarIcon: ({ color, focused }) => (
            <View className="relative items-center justify-center">
              <Camera
                size={22}
                color={focused ? '#10B981' : color}
                strokeWidth={focused ? 2.4 : 2}
              />
              {currentBlockId ? (
                <View className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-subject-premed" />
              ) : null}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="subjects/index"
        options={{
          title: 'Subjects',
          tabBarIcon: ({ color, size }) => (
            <Layers size={size - 2} color={color} strokeWidth={2} />
          ),
        }}
      />
    </Tabs>
  );
}

