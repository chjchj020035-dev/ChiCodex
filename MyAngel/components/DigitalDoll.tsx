import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

type DollMood = 'CALM' | 'LISTENING' | 'CURIOUS' | 'SYNCING';

interface DigitalDollProps {
  aiName: string;
  aiAvatar: string;
  isThinking?: boolean;
}

const moodCopy: Record<DollMood, string> = {
  CALM: '我在这里，陪你慢慢整理今天。',
  LISTENING: '正在听你的声音…',
  CURIOUS: '嗯？这个想法很有意思。',
  SYNCING: '正在同步新的思绪…',
};

export default function DigitalDoll({ aiName, aiAvatar, isThinking = false }: DigitalDollProps) {
  const floatY = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0.4)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  const [manualMood, setManualMood] = useState<DollMood>('CALM');

  useEffect(() => {
    const floating = Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: -5, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(floatY, { toValue: 0, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.9, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.4, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    const orbiting = Animated.loop(
      Animated.timing(orbit, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }),
    );
    const blinking = Animated.loop(
      Animated.sequence([
        Animated.delay(2800),
        Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 0, duration: 130, useNativeDriver: true }),
        Animated.delay(120),
      ]),
    );
    floating.start();
    breathing.start();
    orbiting.start();
    blinking.start();
    return () => {
      floating.stop();
      breathing.stop();
      orbiting.stop();
      blinking.stop();
    };
  }, [floatY, glow, orbit, blink]);

  const mood: DollMood = isThinking ? 'SYNCING' : manualMood;
  const moodIndex = useMemo(() => ['CALM', 'LISTENING', 'CURIOUS'].indexOf(manualMood), [manualMood]);

  const handlePress = () => {
    setManualMood(['CALM', 'LISTENING', 'CURIOUS'][(moodIndex + 1) % 3] as DollMood);
  };

  return (
    <Animated.View style={[styles.shell, { transform: [{ translateY: floatY }] }]}>
      <View style={styles.statusLine}>
        <View style={styles.statusIdentity}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{mood}</Text>
        </View>
        <Text style={styles.stageLabel}>STAGE / 01</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${aiName} 数字人偶，当前状态 ${mood}`}
        onPress={handlePress}
        onPressIn={() => Animated.spring(pressScale, { toValue: 0.96, useNativeDriver: true, speed: 24, bounciness: 4 }).start()}
        onPressOut={() => Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 5 }).start()}
      >
        <Animated.View style={[styles.dollFrame, { transform: [{ scale: pressScale }] }]}> 
          <View style={styles.depthShadow} />
          <Animated.View style={[styles.neonRing, { opacity: glow }]} />
          <View style={styles.innerRing} />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.orbit,
              {
                transform: [
                  { rotate: orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
                ],
              },
            ]}
          >
            <View style={styles.orbitDot} />
          </Animated.View>
          <Image source={{ uri: aiAvatar }} style={styles.dollImage} contentFit="cover" transition={180} />
          <Animated.View pointerEvents="none" style={[styles.blinkMask, { transform: [{ scaleY: blink.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] }) }] }]} />
          <View style={styles.scanLine} />
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
          <View style={styles.heartBadge}>
            <Ionicons name={isThinking ? 'pulse' : 'heart'} size={12} color="#08101f" />
          </View>
        </Animated.View>
      </Pressable>

      <View style={styles.nameRow}>
        <Text style={styles.name}>{aiName}</Text>
        <Text style={styles.version}>AI / SOUL</Text>
      </View>
      <View style={styles.bubble}>
        <Text style={styles.bubbleText}>{moodCopy[mood]}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: 210,
    alignItems: 'center',
  },
  statusLine: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 7,
    paddingHorizontal: 3,
  },
  statusIdentity: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#72f1c6', marginRight: 5 },
  statusText: { color: '#72f1c6', fontSize: 9, fontWeight: '700', letterSpacing: 1.1 },
  stageLabel: { color: '#586884', fontSize: 8, letterSpacing: 1 },
  dollFrame: {
    width: 174,
    height: 218,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d1728',
    borderWidth: 1,
    borderColor: '#31446b',
    shadowColor: '#8be9fd',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  depthShadow: { position: 'absolute', width: 144, height: 190, borderRadius: 32, backgroundColor: '#172b49', opacity: 0.7, transform: [{ translateY: 11 }, { scale: 1.05 }] },
  neonRing: { position: 'absolute', width: 168, height: 212, borderRadius: 35, borderWidth: 2, borderColor: '#8be9fd' },
  innerRing: { position: 'absolute', width: 152, height: 196, borderRadius: 30, borderWidth: 1, borderColor: '#35527f' },
  orbit: { position: 'absolute', width: 198, height: 198, borderRadius: 99, alignItems: 'center', justifyContent: 'flex-start' },
  orbitDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#72f1c6', shadowColor: '#72f1c6', shadowOpacity: 0.9, shadowRadius: 8 },
  dollImage: { width: 136, height: 182, borderRadius: 30, borderWidth: 3, borderColor: '#b5f7ff' },
  blinkMask: { position: 'absolute', width: 124, height: 14, borderRadius: 8, backgroundColor: '#101b30', top: 82, opacity: 0.8 },
  scanLine: { position: 'absolute', left: 22, right: 22, top: 108, height: 1, backgroundColor: '#8be9fd', opacity: 0.22 },
  corner: { position: 'absolute', width: 14, height: 14, borderColor: '#72f1c6' },
  cornerTopLeft: { left: 13, top: 28, borderLeftWidth: 1, borderTopWidth: 1 },
  cornerTopRight: { right: 13, top: 28, borderRightWidth: 1, borderTopWidth: 1 },
  cornerBottomLeft: { left: 13, bottom: 28, borderLeftWidth: 1, borderBottomWidth: 1 },
  cornerBottomRight: { right: 13, bottom: 28, borderRightWidth: 1, borderBottomWidth: 1 },
  heartBadge: { position: 'absolute', right: 9, bottom: 18, width: 29, height: 29, borderRadius: 15, backgroundColor: '#8be9fd', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#08101f' },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 7 },
  name: { color: '#f4f7fb', fontSize: 14, fontWeight: '700' },
  version: { color: '#68758e', fontSize: 8, letterSpacing: 0.8 },
  bubble: { marginTop: 8, width: '100%', paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#121c2d', borderWidth: 1, borderColor: '#2b4165', borderRadius: 12, borderBottomRightRadius: 3 },
  bubbleText: { color: '#aab9d0', fontSize: 10, lineHeight: 14, textAlign: 'center' },
});
