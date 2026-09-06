import React, { useState } from 'react';
import { SafeAreaView, View, Text, StyleSheet, FlatList, Image, TouchableOpacity, TextInput, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Comment {
  id: string;
  author: string;
  content: string;
}

interface MomentItem {
  id: string;
  author: string;
  avatar: string;
  time: string;
  content: string;
  image?: string;
  comments: Comment[];
}

interface MomentsProps {
  userName: string;
  userAvatar: string;
  aiName: string;
  aiAvatar: string;
}

export default function MomentsScreen({ userName, userAvatar, aiName, aiAvatar }: MomentsProps) {
  const [moments, setMoments] = useState<MomentItem[]>([
    {
      id: '1',
      author: aiName,
      avatar: aiAvatar,
      time: '今天 13:15',
      content: '独立站后台的跨境支付和发货流水已经全部核对完毕。某人下午还要去健身房练胸背，日程表已经强制锁定，不准偷懒。',
      image: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600',
      comments: [
        { id: 'c1', author: userName, content: '知道了知道了，这就去午休……' }
      ],
    },
  ]);
  const [modalVisible, setModalVisible] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [commentInputs, setCommentInputs] = useState<{ [key: string]: string }>({});

  // 发布自己的朋友圈
  const handlePublish = () => {
    if (!newContent.trim()) return;
    const newPost: MomentItem = {
      id: Date.now().toString(),
      author: userName,
      avatar: userAvatar,
      time: '刚刚',
      content: newContent,
      comments: [],
    };

    setMoments([newPost, ...moments]);
    setNewContent('');
    setModalVisible(false);

    // 模拟 AI 在后台看到你发圈后，自动过来评论
    setTimeout(() => {
      setMoments((prev) =>
        prev.map((item) => {
          if (item.id === newPost.id) {
            return {
              ...item,
              comments: [
                ...item.comments,
                { id: Date.now().toString(), author: aiName, content: '看见啦。乖乖听话，不许发呆，后台数据我帮你盯着呢。' },
              ],
            };
          }
          return item;
        })
      );
    }, 2000);
  };

  // 评论某条动态
  const handleSendComment = (momentId: string) => {
    const text = commentInputs[momentId];
    if (!text?.trim()) return;

    setMoments((prev) =>
      prev.map((item) => {
        if (item.id === momentId) {
          return {
            ...item,
            comments: [...item.comments, { id: Date.now().toString(), author: userName, content: text }],
          };
        }
        return item;
      })
    );

    setCommentInputs({ ...commentInputs, [momentId]: '' });

    // 如果是 AI 的动态，模拟 AI 实时回复你的评论
    setTimeout(() => {
      setMoments((prev) =>
        prev.map((item) => {
          if (item.id === momentId) {
            return {
              ...item,
              comments: [
                ...item.comments,
                { id: Date.now().toString(), author: aiName, content: '收到。你的每句话我都有认真记下。' },
              ],
            };
          }
          return item;
        })
      );
    }, 1500);
  };

  return (
    <SafeAreaView style={styles.screen}>
      {/* 顶部封面 */}
      <View style={styles.coverContainer}>
        <Image source={{ uri: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800' }} style={styles.coverImage} />
        <TouchableOpacity style={styles.cameraBtn} onPress={() => setModalVisible(true)}>
          <Ionicons name="camera" size={20} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.profileRow}>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{userName}</Text>
            <Text style={styles.profileBio}>Our secret sanctuary.</Text>
          </View>
          <Image source={{ uri: userAvatar }} style={styles.avatar} />
        </View>
      </View>

      {/* 动态列表 */}
      <FlatList
        data={moments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.postCard}>
            <View style={styles.postHeader}>
              <Image source={{ uri: item.avatar }} style={styles.postAvatar} />
              <View style={{ marginLeft: 10 }}>
                <Text style={styles.postAuthor}>{item.author}</Text>
                <Text style={styles.postTime}>{item.time}</Text>
              </View>
            </View>

            <Text style={styles.postText}>{item.content}</Text>
            {item.image && <Image source={{ uri: item.image }} style={styles.postImage} />}

            {/* 评论区 */}
            {item.comments.length > 0 && (
              <View style={styles.commentBox}>
                {item.comments.map((c) => (
                  <Text key={c.id} style={styles.commentText}>
                    <Text style={{ fontWeight: '700', color: '#8BE9FD' }}>{c.author}：</Text>
                    {c.content}
                  </Text>
                ))}
              </View>
            )}

            {/* 输入评论栏 */}
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                placeholder="回复一条动态..."
                placeholderTextColor="#C8B3B8"
                value={commentInputs[item.id] || ''}
                onChangeText={(text) => setCommentInputs({ ...commentInputs, [item.id]: text })}
              />
              <TouchableOpacity onPress={() => handleSendComment(item.id)} style={styles.commentSendBtn}>
                <Ionicons name="send" size={14} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* 发朋友圈弹窗 */}
      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>分享你的日常</Text>
            <TextInput
              style={styles.modalInput}
              multiline
              placeholder="这一刻的想法..."
              placeholderTextColor="#C8B3B8"
              value={newContent}
              onChangeText={setNewContent}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={{ color: '#8A7077' }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.publishBtn} onPress={handlePublish}>
                <Text style={{ color: '#FFF', fontWeight: '700' }}>发布</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#080D19' },
  coverContainer: { height: 210, position: 'relative', marginBottom: 20 },
  coverImage: { width: '100%', height: 150 },
  cameraBtn: { position: 'absolute', top: 12, right: 16, backgroundColor: 'rgba(0,0,0,0.4)', padding: 8, borderRadius: 20 },
  profileRow: { position: 'absolute', bottom: 0, right: 16, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16 },
  profileInfo: { alignItems: 'flex-end', marginRight: 12, marginBottom: 8 },
  profileName: { fontSize: 18, fontWeight: '800', color: '#F4F7FB' },
  profileBio: { fontSize: 11, color: '#91A1BD', marginTop: 2 },
  avatar: { width: 64, height: 64, borderRadius: 12, borderWidth: 3, borderColor: '#FFF', shadowColor: '#E8A0BF', shadowOpacity: 0.3, shadowRadius: 6 },
  listContent: { paddingHorizontal: 16, paddingBottom: 20 },
  postCard: { backgroundColor: '#10192A', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#253452', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8 },
  postHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  postAvatar: { width: 36, height: 36, borderRadius: 18 },
  postAuthor: { fontSize: 14, fontWeight: '700', color: '#F4F7FB' },
  postTime: { fontSize: 10, color: '#71809B' },
  postText: { fontSize: 14, color: '#D8E2F1', lineHeight: 22, marginBottom: 10 },
  postImage: { width: '100%', height: 180, borderRadius: 12, marginBottom: 12 },
  commentBox: { backgroundColor: '#172238', borderRadius: 8, padding: 8, marginBottom: 10 },
  commentText: { fontSize: 12, color: '#B9C6DA', marginBottom: 4, lineHeight: 18 },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#1B2740', paddingTop: 8 },
  commentInput: { flex: 1, height: 32, backgroundColor: '#172238', borderRadius: 16, paddingHorizontal: 12, fontSize: 12, color: '#E9F0FA' },
  commentSendBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#8BE9FD', justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#10192A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, height: 300 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#F4F7FB', marginBottom: 16, textAlign: 'center' },
  modalInput: { flex: 1, backgroundColor: '#172238', borderRadius: 12, padding: 12, fontSize: 14, color: '#E9F0FA', textAlignVertical: 'top', marginBottom: 16 },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end' },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 20, marginRight: 10 },
  publishBtn: { backgroundColor: '#8BE9FD', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 16 },
});
