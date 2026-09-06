import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated, Easing, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface MessageItem {
  id: string;
  sender: 'user' | 'claude';
  time: string;
  type: 'text' | 'thought' | 'music';
  content?: string;
  thoughtSteps?: string;
  music?: { title: string; artist: string; cover: string };
}

export default function CustomBubble({ item, userName, userAvatar, aiName, aiAvatar }: { 
  item: MessageItem; 
  userName: string; 
  userAvatar: string; 
  aiName: string; 
  aiAvatar: string; 
}) {
  const isUser = item.sender === 'user';
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (playing) {
      Animated.loop(
        Animated.timing(spinValue, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: true })
      ).start();
    } else {
      spinValue.stopAnimation();
    }
  }, [playing]);

  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const toggleThought = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{item.content}</Text>
        </View>
        <Image source={{ uri: userAvatar }} style={styles.avatar} />
      </View>
    );
  }

  return (
    <View style={styles.claudeRow}>
      <Image source={{ uri: aiAvatar }} style={styles.avatar} />
      <View style={styles.claudeContentCol}>
        
        {item.type === 'thought' && (
          <View style={styles.thoughtContainer}>
            <TouchableOpacity style={styles.thoughtPill} onPress={toggleThought} activeOpacity={0.7}>
              <Ionicons name="radio-outline" size={13} color="#FA233B" />
              <Text style={styles.thoughtTitle}>{item.thoughtSteps || 'Apple Music Sync'}</Text>
              <Ionicons name={expanded ? "chevron-up" : "chevron-forward"} size={13} color="#FA233B" />
            </TouchableOpacity>
            {expanded && (
              <View style={styles.thoughtCard}>
                <Text style={styles.thoughtBody}>{item.content}</Text>
              </View>
            )}
          </View>
        )}

        {item.type === 'text' && (
          <View style={styles.claudeBubble}>
            <Text style={styles.claudeText}>{item.content}</Text>
          </View>
        )}

        {/* Apple Music 联动播放卡片 */}
        {item.type === 'music' && item.music && (
          <View style={styles.musicCard}>
            <Animated.View style={[styles.vinylRecord, { 
              transform: [{ rotate: spin }, { translateX: playing ? 16 : 0 }] 
            }]}>
              <View style={styles.vinylInner} />
            </Animated.View>
            
            <Image source={{ uri: item.music.cover }} style={styles.musicCover} />
            
            <View style={styles.musicMeta}>
              <View style={styles.amHeader}>
                <Ionicons name="musical-notes" size={11} color="#FA233B" />
                <Text style={styles.amLabel}> Apple Music</Text>
              </View>
              <Text style={styles.musicTitle} numberOfLines={1}>{item.music.title}</Text>
              <Text style={styles.musicArtist} numberOfLines={1}>{item.music.artist}</Text>
            </View>

            <TouchableOpacity style={styles.playBtn} onPress={() => setPlaying(!playing)}>
              <Ionicons name={playing ? "pause" : "play"} size={16} color="#FFF" />
            </TouchableOpacity>
          </View>
        )}
        <Text style={styles.timeTag}>{item.time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', marginVertical: 8, paddingHorizontal: 16, alignItems: 'flex-start' },
  claudeRow: { flexDirection: 'row', justifyContent: 'flex-start', marginVertical: 8, paddingHorizontal: 16, alignItems: 'flex-start' },
  avatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#FFF' },
  claudeContentCol: { marginLeft: 12, maxWidth: '78%', alignItems: 'flex-start' },
  userBubble: { backgroundColor: '#F2A7BF', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 22, borderTopRightRadius: 6, marginRight: 10 },
  userText: { color: '#FFF', fontSize: 15, lineHeight: 22 },
  claudeBubble: { backgroundColor: 'rgba(255, 255, 255, 0.85)', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 22, borderTopLeftRadius: 6, borderWidth: 1, borderColor: '#FFF' },
  claudeText: { color: '#5A3E46', fontSize: 15, lineHeight: 23 },
  timeTag: { fontSize: 11, color: '#C8B3B8', marginTop: 6, marginLeft: 4, fontStyle: 'italic' },
  thoughtContainer: { marginBottom: 8 },
  thoughtPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.6)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#FDEAF0' },
  thoughtTitle: { fontSize: 12, color: '#FA233B', marginHorizontal: 6, fontWeight: '600' },
  thoughtCard: { marginTop: 6, padding: 12, backgroundColor: 'rgba(253, 234, 240, 0.8)', borderRadius: 14, borderLeftWidth: 3, borderLeftColor: '#FA233B' },
  thoughtBody: { fontSize: 13, color: '#8A7077', lineHeight: 19, fontStyle: 'italic' },
  
  // Apple Music 卡片专用样式（Apple 经典红白流线质感）
  musicCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.92)', borderRadius: 20, padding: 10, borderWidth: 1, borderColor: '#FFD1D6', width: 270, zIndex: 1, overflow: 'hidden', shadowColor: '#FA233B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10 },
  musicCover: { width: 48, height: 48, borderRadius: 12, zIndex: 2 },
  vinylRecord: { position: 'absolute', left: 32, width: 46, height: 46, borderRadius: 23, backgroundColor: '#1C1C1C', borderWidth: 2, borderColor: '#3A3A3A', justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  vinylInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FA233B', borderWidth: 2, borderColor: '#1C1C1C' },
  musicMeta: { flex: 1, marginLeft: 16, zIndex: 2 },
  amHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  amLabel: { fontSize: 10, fontWeight: '700', color: '#FA233B', letterSpacing: 0.5 },
  musicTitle: { fontSize: 14, fontWeight: '700', color: '#5A3E46', marginBottom: 1 },
  musicArtist: { fontSize: 11, color: '#A68A93' },
  playBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FA233B', justifyContent: 'center', alignItems: 'center', marginLeft: 8, zIndex: 2 },
});
