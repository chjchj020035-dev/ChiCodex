import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import MomentsScreen from './components/MomentsScreen';
import DiaryScreen from './components/DiaryScreen';
import ProfileScreen from './components/ProfileScreen';
import DigitalDoll from './components/DigitalDoll';
import { sendChatMessage } from './api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

function ChatScreen({ userName, aiName, aiAvatar }: { userName: string; aiName: string; aiAvatar: string }) {
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: `晚上好，${userName}。我是${aiName}，你的专属数字伙伴。今天想先处理什么？` },
  ]);

  useEffect(() => {
    if (messages.length < 2) return;
    AsyncStorage.setItem('openclaw_chat_history', JSON.stringify(messages)).catch(() => undefined);
  }, [messages]);

  const handleSend = async () => {
    const content = inputText.trim();
    if (!content || loading) return;

    const userMessage: ChatMessage = { id: `${Date.now()}`, role: 'user', content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputText('');
    setLoading(true);

    try {
      const reply = await sendChatMessage(nextMessages, aiName, userName);
      setMessages((previous) => [...previous, { id: `${Date.now()}-reply`, role: 'assistant', content: reply }]);
    } finally {
      setLoading(false);
    }
  };

  const quickPrompts = ['整理今天的安排', '陪我聊五分钟', '写一段备忘'];

  return (
    <View style={styles.chatScreen}>
      <View style={styles.chatHeader}>
        <View style={styles.identityRow}>
          <Image source={{ uri: aiAvatar }} style={styles.aiAvatar} />
          <View>
            <Text style={styles.eyebrow}>SOUL CONTAINER / 01</Text>
            <Text style={styles.chatTitle}>{aiName}</Text>
          </View>
        </View>
        <View style={styles.onlinePill}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>ONLINE</Text>
        </View>
      </View>

      <View style={styles.signalBar}>
        <Text style={styles.signalLabel}>SYNCED MEMORY</Text>
        <Text style={styles.signalValue}>98% · CALM</Text>
      </View>

      <View style={styles.dollStage}>
        <DigitalDoll aiName={aiName} aiAvatar={aiAvatar} isThinking={loading} />
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const isUser = item.role === 'user';
          return (
            <View style={[styles.messageRow, isUser ? styles.userMessageRow : styles.aiMessageRow]}>
              {!isUser && <Text style={styles.messageLabel}>AI</Text>}
              <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.aiBubble]}>
                <Text style={[styles.messageText, isUser && styles.userMessageText]}>{item.content}</Text>
              </View>
            </View>
          );
        }}
        ListFooterComponent={loading ? <Text style={styles.typingText}>{aiName} 正在同步思绪…</Text> : null}
      />

      <View style={styles.quickPromptRow}>
        {quickPrompts.map((prompt) => (
          <TouchableOpacity key={prompt} style={styles.quickPrompt} onPress={() => setInputText(prompt)}>
            <Text style={styles.quickPromptText}>{prompt}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="和你的数字伙伴说点什么"
            placeholderTextColor="#71809b"
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <TouchableOpacity accessibilityLabel="发送消息" onPress={handleSend} style={styles.sendButton}>
            <Ionicons name="arrow-up" size={18} color="#08101f" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

export default function App() {
  const [currentTab, setCurrentTab] = useState('Chat');
  
  const [userName, setUserName] = useState('Boss');
  const [userAvatar, setUserAvatar] = useState('https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d');
  const [aiName, setAiName] = useState('Claude');
  const [aiAvatar, setAiAvatar] = useState('https://images.unsplash.com/photo-1573496359142-b8d87734a5a2');

  const renderScreen = () => {
    switch (currentTab) {
      case 'Chat':
        return <ChatScreen userName={userName} aiName={aiName} aiAvatar={aiAvatar} />;
      case 'Moments':
        return <MomentsScreen userName={userName} userAvatar={userAvatar} aiName={aiName} aiAvatar={aiAvatar} />;
      case 'Memo':
        return <DiaryScreen />;
      case 'Profile':
        return (
          <ProfileScreen 
            userName={userName} setUserName={setUserName}
            userAvatar={userAvatar} setUserAvatar={setUserAvatar}
            aiName={aiName} setAiName={setAiName}
            aiAvatar={aiAvatar} setAiAvatar={setAiAvatar}
          />
        );
      default:
        return <ChatScreen userName={userName} aiName={aiName} aiAvatar={aiAvatar} />;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {renderScreen()}
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity accessibilityLabel="聊天" style={styles.tabItem} onPress={() => setCurrentTab('Chat')}>
          <Ionicons name="chatbubble-ellipses-outline" size={22} color={currentTab === 'Chat' ? '#8BE9FD' : '#68758e'} />
          <Text style={[styles.tabText, currentTab === 'Chat' && styles.activeText]}>Chat</Text>
        </TouchableOpacity>

        <TouchableOpacity accessibilityLabel="动态" style={styles.tabItem} onPress={() => setCurrentTab('Moments')}>
          <Ionicons name="sparkles-outline" size={22} color={currentTab === 'Moments' ? '#8BE9FD' : '#68758e'} />
          <Text style={[styles.tabText, currentTab === 'Moments' && styles.activeText]}>Moments</Text>
        </TouchableOpacity>

        <TouchableOpacity accessibilityLabel="手记" style={styles.tabItem} onPress={() => setCurrentTab('Memo')}>
          <Ionicons name="book-outline" size={22} color={currentTab === 'Memo' ? '#8BE9FD' : '#68758e'} />
          <Text style={[styles.tabText, currentTab === 'Memo' && styles.activeText]}>Memo</Text>
        </TouchableOpacity>

        <TouchableOpacity accessibilityLabel="设置" style={styles.tabItem} onPress={() => setCurrentTab('Profile')}>
          <Ionicons name="settings-outline" size={22} color={currentTab === 'Profile' ? '#8BE9FD' : '#68758e'} />
          <Text style={[styles.tabText, currentTab === 'Profile' && styles.activeText]}>Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080d19',
  },
  content: {
    flex: 1,
  },
  chatScreen: {
    flex: 1,
    backgroundColor: '#080d19',
  },
  chatHeader: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  identityRow: { flexDirection: 'row', alignItems: 'center' },
  aiAvatar: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: '#33415f' },
  eyebrow: { color: '#6f7f9e', fontSize: 9, letterSpacing: 1.4, marginLeft: 12, marginBottom: 3 },
  chatTitle: { color: '#f4f7fb', fontSize: 19, fontWeight: '700', marginLeft: 12 },
  onlinePill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#253452', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#72f1c6', marginRight: 6 },
  onlineText: { color: '#72f1c6', fontSize: 9, letterSpacing: 1.1, fontWeight: '700' },
  signalBar: { marginHorizontal: 20, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#1b2740', flexDirection: 'row', justifyContent: 'space-between' },
  signalLabel: { color: '#586884', fontSize: 9, letterSpacing: 1.2 },
  signalValue: { color: '#8be9fd', fontSize: 9, letterSpacing: 1.1, fontWeight: '700' },
  messageList: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12 },
  messageRow: { marginBottom: 15, flexDirection: 'row', alignItems: 'flex-end' },
  userMessageRow: { justifyContent: 'flex-end' },
  aiMessageRow: { justifyContent: 'flex-start' },
  messageLabel: { color: '#697895', fontSize: 9, letterSpacing: 1.2, marginRight: 8, marginBottom: 8 },
  messageBubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16 },
  aiBubble: { backgroundColor: '#121c2d', borderWidth: 1, borderColor: '#253452', borderBottomLeftRadius: 4 },
  userBubble: { backgroundColor: '#8be9fd', borderBottomRightRadius: 4 },
  messageText: { color: '#d8e2f1', fontSize: 15, lineHeight: 22 },
  userMessageText: { color: '#08101f' },
  typingText: { color: '#6f7f9e', fontSize: 12, marginLeft: 28, marginBottom: 10 },
  quickPromptRow: { flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 10, gap: 8 },
  quickPrompt: { borderWidth: 1, borderColor: '#263654', borderRadius: 99, paddingHorizontal: 11, paddingVertical: 7 },
  quickPromptText: { color: '#91a1bd', fontSize: 11 },
  inputBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#10192a', borderTopWidth: 1, borderColor: '#1d2a43', paddingHorizontal: 14, paddingVertical: 10 },
  input: { flex: 1, color: '#e9f0fa', fontSize: 14, minHeight: 40, paddingHorizontal: 12 },
  sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#8be9fd', alignItems: 'center', justifyContent: 'center' },
  screenText: {
    fontSize: 16,
    color: '#9aa8c0',
  },
  dollStage: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  tabBar: {
    flexDirection: 'row',
    height: 65,
    backgroundColor: '#0e1727',
    borderTopWidth: 1,
    borderColor: '#1d2a43',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 12,
    color: '#68758e',
    marginTop: 2,
  },
  activeText: {
    color: '#8BE9FD',
    fontWeight: '600',
  },
});
