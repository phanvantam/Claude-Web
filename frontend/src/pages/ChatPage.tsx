import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Typography, Button, Tag, Space, message } from 'antd';
import {
  ArrowLeftOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { projectsApi } from '../services/api';
import { useChat } from '../hooks/useChat';
import ChatWindow from '../components/Chat/ChatWindow';
import InputBox from '../components/Chat/InputBox';
import type { Project } from '../types';

const { Text } = Typography;

const ChatPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  
  const querySessionId = searchParams.get('sessionId');

  const {
    messages,
    streamingContent,
    streamingBlocks,
    isThinking,
    status,
    sessionId,
    startSession,
    sendMessage,
    abortGeneration,
    stopSession,
    clearMessages,
  } = useChat();

  const lastStartedRef = React.useRef<string | null>(null);

  // Load project info
  useEffect(() => {
    if (projectId) {
      projectsApi.getById(projectId).then(p => {
        setProject(p);
      }).catch(() => {
        message.error('Không tìm thấy dự án');
        navigate('/');
      });
    }
  }, [projectId, navigate]);

  // Connect to session only when needed
  useEffect(() => {
    if (!projectId || !project) return;

    const isNew = searchParams.get('new') === 'true';
    const desiredSessionId = isNew ? null : (querySessionId || project.activeSessionId || null);
    
    // Check if we already have the correct session active
    if (sessionId === desiredSessionId && sessionId !== null) {
      return; 
    }

    const startKey = desiredSessionId || 'new';
    if (lastStartedRef.current !== startKey) {
      console.log(`[ChatPage] Connecting: desiredSessionId=${desiredSessionId}, currentSessionId=${sessionId}`);
      lastStartedRef.current = startKey;
      startSession(project.id, desiredSessionId || undefined);
      
      if (isNew) {
        navigate(`/chat/${projectId}`, { replace: true });
      }
    }
  }, [projectId, querySessionId, project, startSession, sessionId, navigate, searchParams]);

  const handleStartSession = () => {
    if (projectId) {
      startSession(projectId);
    }
  };

  const handleSend = (text: string) => {
    if (!sessionId) {
      message.warning('Hãy bắt đầu phiên chat trước');
      return;
    }
    sendMessage(text);
  };

  const getStatusColor = () => {
    if (!sessionId) return 'default';
    if (status === 'thinking') return 'processing';
    if (status === 'tool_use') return 'warning';
    return 'success';
  };

  const getStatusText = () => {
    if (!sessionId) return 'Chưa kết nối';
    if (status === 'thinking') return 'Đang suy nghĩ...';
    if (status === 'tool_use') return 'Đang dùng công cụ...';
    return 'Sẵn sàng';
  };

  return (
    <div className="chat-page">
      {/* Chat Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
            style={{ color: 'rgba(255,255,255,0.6)' }}
          />
          <div className="chat-header-info">
            <Text strong style={{ color: '#fff', fontSize: 15 }}>
              {project?.name || 'Loading...'}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
              {project?.path}
            </Text>
          </div>
        </div>

        <Space>
          <Tag color={getStatusColor()} style={{ borderRadius: 12 }}>
            {getStatusText()}
          </Tag>

          {!sessionId ? (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStartSession}
              className="primary-btn"
            >
              Bắt đầu
            </Button>
          ) : (
            <>
              <Button
                type="text"
                icon={<DeleteOutlined />}
                onClick={clearMessages}
                style={{ color: 'rgba(255,255,255,0.4)' }}
                title="Xóa tin nhắn"
              />
              <Button
                danger
                icon={<PoweroffOutlined />}
                onClick={stopSession}
              >
                Dừng
              </Button>
            </>
          )}
        </Space>
      </div>

      {/* Chat Messages */}
      <ChatWindow
        messages={messages}
        streamingContent={streamingContent}
        streamingBlocks={streamingBlocks}
        isThinking={isThinking}
        status={status}
      />

      {/* Input Box */}
      <InputBox
        onSend={handleSend}
        onAbort={abortGeneration}
        disabled={!sessionId}
        isThinking={isThinking}
      />
    </div>
  );
};

export default ChatPage;
