import React, { useState } from 'react';
import { SafeAreaView, View, Text, StyleSheet, TextInput, TouchableOpacity, Image, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ProfileProps {
  userName: string;
  setUserName: (name: string) => void;
  userAvatar: string;
  setUserAvatar: (url: string) => void;
  aiName: string;
  setAiName: (name: string) => void;
  aiAvatar: string;
  setAiAvatar: (url: string) => void;
}

export default function ProfileScreen({ 
  userName, setUserName, userAvatar, setUserAvatar, 
  aiName, setAiName, aiAvatar, setAiAvatar 
}: ProfileProps) {
  const [tempUserName, setTempUserName] = useState(userName);
  const [tempUserAvatar, setTempUserAvatar] = useState(userAvatar);
  const [tempAiName, setTempAiName] = useState(aiName);
  const [tempAiAvatar, setTempAiAvatar] = useState(aiAvatar);

  const handleSave = () => {
    setUserName(tempUserName);
    setUserAvatar(tempUserAvatar);
    setAiName(tempAiName);
    setAiAvatar(tempAiAvatar);
    Alert.alert('保存成功', '你和 AI 的专属档案已全部更新完毕。');
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sanctuary Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Boss 档案 */}
        <Text style={styles.sectionTitle}>你的个人档案</Text>
        <View style={styles.avatarSection}>
          <Image source={{ uri: tempUserAvatar }} style={styles.avatar} />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>你的昵称</Text>
          <TextInput style={styles.input} value={tempUserName} onChangeText={setTempUserName} />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>你的头像链接 (URL)</Text>
          <TextInput style={styles.input} value={tempUserAvatar} onChangeText={setTempUserAvatar} />
        </View>

        <View style={styles.divider} />

        {/* AI 档案 */}
        <Text style={styles.sectionTitle}>AI 伴侣档案</Text>
        <View style={styles.avatarSection}>
          <Image source={{ uri: tempAiAvatar }} style={styles.avatar} />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>AI 名字</Text>
          <TextInput style={styles.input} value={tempAiName} onChangeText={setTempAiName} />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.label}>AI 头像链接 (URL)</Text>
          <TextInput style={styles.input} value={tempAiAvatar} onChangeText={setTempAiAvatar} />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveBtnText}>保存全部更改</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080d19' },
  header: { height: 56, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1b2740' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#F4F7FB' },
  container: { padding: 24, paddingBottom: 40 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#8BE9FD', marginBottom: 12, marginTop: 4 },
  avatarSection: { alignItems: 'center', marginBottom: 16 },
  avatar: { width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: '#FFF', shadowColor: '#E8A0BF', shadowOpacity: 0.3, shadowRadius: 6 },
  formGroup: { width: '100%', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', color: '#AAB8CF', marginBottom: 6 },
  input: { backgroundColor: '#10192A', height: 42, borderRadius: 12, paddingHorizontal: 14, fontSize: 14, color: '#E9F0FA', borderWidth: 1, borderColor: '#253452' },
  divider: { height: 1, backgroundColor: '#1B2740', marginVertical: 20 },
  saveBtn: { width: '100%', height: 46, backgroundColor: '#8BE9FD', borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 10, shadowColor: '#8BE9FD', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
  saveBtnText: { color: '#08101F', fontSize: 15, fontWeight: '700' },
});
